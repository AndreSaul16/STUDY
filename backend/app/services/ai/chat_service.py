"""
Chat Service — servicio de chat IA con OpenAI + MCP tools.

Usa OpenAI function calling para que el LLM pueda llamar a las herramientas
del MCP (get_verse_with_study, getWatchtowerContent, etc.) y a las nativas
(leer_pasaje_biblico, buscar_en_biblioteca…), y responder basado SOLO en
contenido JW.

Flujo:
  1. Usuario envía mensaje (con un modo de redacción opcional)
  2. BUCLE multi-ronda de tool-calling (hasta CHAT_MAX_TOOL_ROUNDS, con
     presupuesto de tiempo): el LLM pide herramientas, se ejecutan via MCP
     bridge o nativas (en thread) y se le devuelven los resultados. Repite
     mientras siga pidiendo herramientas
  3. Cierre de brechas: si la investigación no cumple el mínimo del modo
     (ver research_policy), se inyecta un recordatorio y se fuerza una ronda
  4. Se emiten las fuentes acumuladas y la metadata
  5. Ronda final de respuesta en streaming SIN tools
  6. Sugerencias de continuación y cierre

Diseño async: usa AsyncOpenAI para no bloquear el event loop. Las llamadas
síncronas al MCP bridge se ejecutan con asyncio.to_thread.

Los eventos SSE nuevos (tool_result, sources, suggestions, comentarios de
keepalive) son ADITIVOS: un cliente antiguo que no los conoce los ignora.
"""

import asyncio
import json
import logging
import os
import time
from typing import AsyncGenerator, Dict, Any, List, Optional, Sequence

from openai import AsyncOpenAI

from .chat_modes import DEFAULT_MODE, CHAT_MODES, ModeSpec, get_mode, list_modes
from .mcp_bridge import get_mcp_bridge
from .native_tools import NATIVE_TOOLS, call_native_tool, is_native_tool
from .research_policy import (
    budget_exhausted,
    executed_tool_names,
    research_gap,
    tool_cache_key,
)
from .source_tracker import SourceTracker
from .style_guide import (
    CITATION_CONTRACT,
    IDENTITY,
    LANGUAGE_POLICY,
    RESEARCH_POLICY,
    TOOL_CATALOG,
    VOICE_GUIDE,
)

logger = logging.getLogger(__name__)


# Configuración OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "2000"))

# ─── reasoning_effort ────────────────────────────────────────────
# Los modelos de razonamiento (gpt-5.x, o-series) aceptan reasoning_effort con
# valores 'none' | 'low' | 'medium' | 'high' | 'xhigh'. DOS restricciones reales
# (verificadas contra la API, no supuestas):
#
#   1. Cualquier otro valor (p. ej. "max") → 400 invalid_request_error y el chat
#      entero se cae. Por eso validamos contra la lista blanca y degradamos a
#      'none' en vez de propagar el fallo.
#   2. Con `tools` en /v1/chat/completions SOLO se admite 'none':
#      "Function tools with reasoning_effort are not supported ... set
#      reasoning_effort to 'none'". Por eso las rondas de tool-calling van
#      siempre con 'none' y el effort configurado se reserva para la ronda
#      final de redacción, que va SIN tools y sí puede razonar.
#
# Pon la variable vacía ("") para modelos clásicos (gpt-4o-mini) que no
# aceptan el parámetro en absoluto.
_VALID_EFFORTS = frozenset({"none", "low", "medium", "high", "xhigh"})

_raw_effort = os.getenv("OPENAI_REASONING_EFFORT", "none").strip().lower()
if _raw_effort and _raw_effort not in _VALID_EFFORTS:
    logger.warning(
        "OPENAI_REASONING_EFFORT=%r no es válido (admitidos: %s). Usando 'none'.",
        _raw_effort,
        ", ".join(sorted(_VALID_EFFORTS)),
    )
    _raw_effort = "none"

OPENAI_REASONING_EFFORT = _raw_effort

# Rondas con tools: forzado a 'none' (restricción 2).
_TOOL_PARAMS: Dict[str, Any] = {"reasoning_effort": "none"} if OPENAI_REASONING_EFFORT else {}
# Ronda final sin tools: se respeta el effort configurado.
_ANSWER_PARAMS: Dict[str, Any] = (
    {"reasoning_effort": OPENAI_REASONING_EFFORT} if OPENAI_REASONING_EFFORT else {}
)


# ─── Configuración de la investigación ───────────────────────────
# Basura en el entorno degrada al default en vez de tumbar el arranque: una
# variable mal escrita en Railway no puede dejar el chat sin servicio.
def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r no es un número. Usando %s.", name, raw, default)
        return default
    return max(minimum, min(value, maximum))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "si", "sí", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    logger.warning("%s=%r no es un booleano. Usando %s.", name, raw, default)
    return default


#: Rondas máximas de tool-calling antes de forzar la respuesta final.
CHAT_MAX_TOOL_ROUNDS = _env_int("CHAT_MAX_TOOL_ROUNDS", 5, 1, 10)

#: Segundos de investigación antes de cortar y redactar con lo que haya. Los
#: proxies cortan streams largos; mejor una respuesta con 3 fuentes que un 502.
CHAT_RESEARCH_BUDGET_SECONDS = _env_int("CHAT_RESEARCH_BUDGET_SECONDS", 75, 10, 600)

#: ¿Generar sugerencias de continuación con una llamada corta extra?
CHAT_FOLLOWUPS = _env_bool("CHAT_FOLLOWUPS", True)

#: Alias histórico. El bucle usa CHAT_MAX_TOOL_ROUNDS.
MAX_TOOL_ROUNDS = CHAT_MAX_TOOL_ROUNDS

#: Recordatorio cuando el modelo se conforma con menos rondas de las que el
#: modo exige, aunque lo consultado no encaje en ninguna brecha concreta.
_GAP_TOO_FEW_ROUNDS = (
    "Te has quedado corto de investigación para esta pieza: necesita al menos "
    "{minimo} rondas de consulta a las fuentes. Contrasta lo que tienes con "
    "otra fuente relevante antes de redactar."
)

_FOLLOWUPS_PROMPT = (
    "Devuelve SOLO un array JSON con 3 preguntas breves (máx. 9 palabras cada "
    "una), en español, que este usuario querría hacer a continuación sobre lo "
    "que acabas de responder. Sin numeración, sin texto fuera del array."
)


def build_system_prompt(mode: ModeSpec) -> str:
    """
    Compone el system prompt del chat para un modo concreto.

    El orden importa: primero quién eres y cómo investigas, después la voz (que
    aplica siempre), y solo entonces la plantilla de la pieza. El contrato de
    citas va al final para que quede cerca de la generación.
    """
    return "\n\n".join(
        [
            IDENTITY,
            RESEARCH_POLICY,
            LANGUAGE_POLICY,
            VOICE_GUIDE,
            mode.prompt,
            CITATION_CONTRACT,
            TOOL_CATALOG,
        ]
    )


#: Prompt del modo por defecto. Se conserva a nivel de módulo por compatibilidad
#: con cualquier código que lo importara.
SYSTEM_PROMPT = build_system_prompt(get_mode(None))


def parse_followups(raw: str, fallback: Sequence[str]) -> List[str]:
    """
    Parseo defensivo de las sugerencias que devuelve el modelo.

    Acepta un array JSON, con o sin valla de markdown alrededor. Cualquier otra
    cosa (texto suelto, JSON inválido, lista vacía) cae al respaldo estático del
    modo: las sugerencias son un adorno, nunca deben romper el turno.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        # ```json\n[...]\n```
        text = text.split("\n", 1)[-1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[: -len("```")]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return list(fallback)[:3]

    if not isinstance(parsed, list):
        return list(fallback)[:3]

    items = [item.strip() for item in parsed if isinstance(item, str) and item.strip()]
    if not items:
        return list(fallback)[:3]
    return items[:3]


class ChatService:
    """Servicio de chat IA con OpenAI + MCP tools."""

    def __init__(self):
        if not OPENAI_API_KEY or OPENAI_API_KEY == "sk-your-api-key-here":
            raise ValueError(
                "OPENAI_API_KEY no configurada. Añádela en backend/.env"
            )
        self.client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        # Sólo las del MCP (para diagnóstico en /api/chat/health).
        self.mcp_tools: list[Dict[str, Any]] = []
        # Las que realmente se le ofrecen al modelo: nativas + MCP.
        self.tools: list[Dict[str, Any]] = []
        self._tools_loaded = False

    def _load_mcp_tools_sync(self) -> list[Dict[str, Any]]:
        """Carga las herramientas del MCP y las convierte a formato OpenAI.

        Síncrono (usa el bridge stdio); se invoca via asyncio.to_thread.
        """
        bridge = get_mcp_bridge()
        tools = bridge.list_tools()
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", {}),
                },
            }
            for tool in tools
        ]

    async def ensure_tools(self) -> None:
        """
        Deja ``self.tools`` listo (idempotente).

        Las herramientas nativas están SIEMPRE; las del MCP se añaden encima si
        el bridge arranca. Que el MCP falle degrada la calidad (sin notas de
        estudio ni vídeos), pero ya no deja al chat sin fuentes.
        """
        if self._tools_loaded:
            return
        try:
            self.mcp_tools = await asyncio.to_thread(self._load_mcp_tools_sync)
        except Exception:
            logger.warning(
                "MCP no disponible; el chat seguirá con las herramientas nativas",
                exc_info=True,
            )
            self.mcp_tools = []
        self.tools = [*NATIVE_TOOLS, *self.mcp_tools]
        self._tools_loaded = True

    async def _run_tool(self, name: str, args: Dict[str, Any]) -> str:
        """Ejecuta una herramienta (nativa o MCP) y devuelve su resultado en JSON."""
        try:
            if is_native_tool(name):
                result = await asyncio.to_thread(call_native_tool, name, args)
            else:
                bridge = get_mcp_bridge()
                result = await asyncio.to_thread(bridge.call_tool, name, args)
            return json.dumps(result, ensure_ascii=False)
        except Exception:
            logger.exception("Error ejecutando herramienta %s", name)
            return json.dumps({"error": "tool execution failed"})

    async def _generate_followups(
        self, full_messages: list[Dict[str, Any]], answer: str, mode: ModeSpec
    ) -> List[str]:
        """
        Sugerencias de continuación. Llamada corta, sin tools, sin streaming.

        Si algo falla (o están desactivadas) se usan las estáticas del modo: no
        merece la pena arriesgar el turno por tres chips.
        """
        if not CHAT_FOLLOWUPS or not answer.strip():
            return list(mode.followups)[:3]

        try:
            response = await self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    *full_messages,
                    {"role": "assistant", "content": answer},
                    {"role": "user", "content": _FOLLOWUPS_PROMPT},
                ],
                max_completion_tokens=200,
                **({"reasoning_effort": "none"} if OPENAI_REASONING_EFFORT else {}),
            )
        except Exception:
            logger.warning("No se pudieron generar sugerencias", exc_info=True)
            return list(mode.followups)[:3]

        raw = response.choices[0].message.content or ""
        return parse_followups(raw, mode.followups)

    async def chat_stream(
        self, messages: list[Dict[str, str]], mode: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Genera una respuesta de chat con streaming SSE.

        Args:
            messages: lista de mensajes {role, content}
            mode: id del modo de redacción; desconocido o None → modo por defecto

        Yields:
            Eventos SSE formateados (event: type\\ndata: json\\n\\n)
        """
        start_time = time.time()
        await self.ensure_tools()

        mode_spec = get_mode(mode)
        full_messages: list[Dict[str, Any]] = [
            {"role": "system", "content": build_system_prompt(mode_spec)}
        ] + list(messages)

        total_tokens = 0
        total_tool_calls = 0
        tracker = SourceTracker()
        # Caché por petición: el modelo reabre el mismo doc_id en rondas
        # distintas con frecuencia, y cada scrape cuesta ~20 s.
        tool_cache: Dict[str, str] = {}
        gap_round_used = False
        rounds_with_tools = 0

        # ─── BUCLE MULTI-RONDA de tool-calling ────────────────────────
        # El modelo puede pedir herramientas en varias rondas para buscar en
        # múltiples fuentes (versículos, Atalaya, guía, videos). Cada ronda es
        # NO-streaming: solo recogemos las tool_calls, las ejecutamos y le
        # devolvemos los resultados. Cuando deja de pedir herramientas (o se
        # agota el presupuesto) salimos y hacemos la respuesta final en
        # streaming SIN tools (para forzar que responda).
        if self.tools:
            force_tools = True
            for round_idx in range(CHAT_MAX_TOOL_ROUNDS):
                if round_idx > 0 and budget_exhausted(
                    start_time, CHAT_RESEARCH_BUDGET_SECONDS, time.time()
                ):
                    logger.info(
                        "Presupuesto de investigación agotado tras %s rondas", round_idx
                    )
                    break

                # 1ª ronda (y la de cierre de brechas): forzamos tool use. El
                # resto en "auto": el modelo decide si necesita más fuentes.
                tool_choice = "required" if force_tools else "auto"
                force_tools = False
                try:
                    response = await self.client.chat.completions.create(
                        model=OPENAI_MODEL,
                        messages=full_messages,
                        tools=self.tools,
                        tool_choice=tool_choice,
                        max_completion_tokens=OPENAI_MAX_TOKENS,
                        **_TOOL_PARAMS,
                    )
                except Exception:
                    logger.exception(
                        "OpenAI call failed (ronda de tools %s)", round_idx
                    )
                    yield self._format_sse(
                        "error",
                        {"message": "Error al conectar con el proveedor de IA"},
                    )
                    return

                if getattr(response, "usage", None):
                    total_tokens += response.usage.total_tokens

                message = response.choices[0].message
                raw_tool_calls = message.tool_calls or []

                if not raw_tool_calls:
                    # El modelo dejó de pedir herramientas. ¿Investigó lo
                    # suficiente para el modo? Si no, una única ronda extra con
                    # el recordatorio concreto de lo que le falta.
                    gap = research_gap(executed_tool_names(full_messages), mode_spec)
                    if gap is None and rounds_with_tools < mode_spec.min_tool_rounds:
                        gap = _GAP_TOO_FEW_ROUNDS.format(
                            minimo=mode_spec.min_tool_rounds
                        )
                    if (
                        gap
                        and not gap_round_used
                        and not budget_exhausted(
                            start_time, CHAT_RESEARCH_BUDGET_SECONDS, time.time()
                        )
                    ):
                        gap_round_used = True
                        force_tools = True
                        full_messages.append({"role": "system", "content": gap})
                        continue
                    break

                rounds_with_tools += 1

                # Añadir el mensaje assistant con las tool_calls solicitadas.
                assistant_tool_calls = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                    for tc in raw_tool_calls
                ]
                full_messages.append({
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": assistant_tool_calls,
                })

                # Ejecutar cada herramienta (nativa o MCP, en thread) y emitir
                # un evento SSE tool_call por cada una.
                for tc in raw_tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        tool_args = {}

                    total_tool_calls += 1
                    yield self._format_sse(
                        "tool_call", {"name": tool_name, "arguments": tool_args}
                    )

                    # Keepalive: un scrape puede tardar 20 s sin emitir un solo
                    # byte, y los proxies cortan el SSE por inactividad.
                    yield ": ping\n\n"

                    cache_key = tool_cache_key(tool_name, tool_args)
                    content = tool_cache.get(cache_key)
                    if content is None:
                        content = await self._run_tool(tool_name, tool_args)
                        tool_cache[cache_key] = content

                    yield ": ping\n\n"

                    try:
                        parsed_result = json.loads(content)
                    except (json.JSONDecodeError, TypeError):
                        parsed_result = {}

                    tracker.record(tool_name, tool_args, parsed_result)
                    yield self._format_sse(
                        "tool_result",
                        {
                            "name": tool_name,
                            "summary": tracker.summary(tool_name, parsed_result),
                        },
                    )

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": content,
                    })

            yield self._format_sse("sources", {"items": tracker.sources()})
            yield self._format_sse(
                "metadata",
                {
                    "tool_calls": total_tool_calls,
                    "model": OPENAI_MODEL,
                    "mode": mode_spec.id,
                },
            )

        # ─── Ronda final: respuesta en streaming SIN tools ────────────
        answer = ""
        try:
            final_stream = await self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=full_messages,
                max_completion_tokens=min(OPENAI_MAX_TOKENS, mode_spec.max_tokens),
                stream=True,
                stream_options={"include_usage": True},
                **_ANSWER_PARAMS,
            )
            async for chunk in final_stream:
                if getattr(chunk, "usage", None):
                    total_tokens += chunk.usage.total_tokens
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    answer += delta.content
                    yield self._format_sse("token", {"text": delta.content})
        except Exception:
            logger.exception("OpenAI stream failed (respuesta final)")
            yield self._format_sse(
                "error", {"message": "Error al generar la respuesta final"}
            )
            return

        suggestions = await self._generate_followups(full_messages, answer, mode_spec)
        if suggestions:
            yield self._format_sse("suggestions", {"items": suggestions})

        elapsed_ms = int((time.time() - start_time) * 1000)
        yield self._format_sse(
            "done", {"total_tokens": total_tokens, "elapsed_ms": elapsed_ms}
        )

    def _format_sse(self, event: str, data: Dict[str, Any]) -> str:
        """Formatea un evento SSE."""
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Singleton
_service: Optional[ChatService] = None


def get_chat_service() -> ChatService:
    """Obtiene el singleton del chat service."""
    global _service
    if _service is None:
        _service = ChatService()
    return _service


__all__ = [
    "ChatService",
    "get_chat_service",
    "build_system_prompt",
    "parse_followups",
    "SYSTEM_PROMPT",
    "CHAT_MODES",
    "DEFAULT_MODE",
    "get_mode",
    "list_modes",
    "OPENAI_MODEL",
]
