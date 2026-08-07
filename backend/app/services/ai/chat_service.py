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
from typing import AsyncGenerator, Dict, Any, Iterator, List, Optional, Sequence

from .chat_modes import DEFAULT_MODE, CHAT_MODES, ModeSpec, get_mode, list_modes
from .chat_providers import (
    PROVIDERS,
    RETRY_RESERVE,
    ChatRuntime,
    ReasoningStripper,
    build_runtime,
    echo_assistant_message,
    effort_params,
    server_runtime,
    tool_choice_for,
)
from .local_library import LocalSnippet, build_context_message
from .mcp_bridge import get_mcp_bridge
from .native_tools import NATIVE_TOOLS, call_native_tool, is_native_tool, tools_for
from .redaction import provider_error_message, redact
from .research_config import ResearchConfig
from .research_policy import (
    budget_exhausted,
    executed_tool_names,
    research_gap,
    tool_cache_key,
)
from .source_tracker import SourceTracker
from .style_guide import (
    CITATION_CONTRACT,
    DATE_POLICY,
    DOCTRINAL_POLICY,
    IDENTITY,
    LANGUAGE_POLICY,
    RESEARCH_POLICY,
    RESOURCEFULNESS,
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

# Los params del MODO SERVIDOR, derivados ya de la capa de proveedor: las
# rondas con tools van con lo que el proveedor imponga ('none' en OpenAI) y la
# ronda final con el effort configurado. Se conservan a nivel de módulo porque
# son la configuración por defecto del despliegue y hay tests que la blindan.
_TOOL_PARAMS: Dict[str, Any]
_ANSWER_PARAMS: Dict[str, Any]
_TOOL_PARAMS, _ANSWER_PARAMS = effort_params(
    PROVIDERS["openai"], OPENAI_REASONING_EFFORT
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


def build_system_prompt(mode: ModeSpec, web_enabled: bool = False) -> str:
    """
    Compone el system prompt del chat para un modo concreto.

    El orden importa: primero quién eres y cómo investigas, después la voz (que
    aplica siempre), y solo entonces la plantilla de la pieza. El contrato de
    citas va al final para que quede cerca de la generación.

    ``DOCTRINAL_POLICY`` solo entra si hay búsqueda externa activada: habla de
    una herramienta que en el resto de los casos no existe, y darle al modelo
    reglas sobre algo que no puede hacer solo gasta contexto y le invita a
    intentar llamarla.
    """
    bloques = [
        IDENTITY,
        RESEARCH_POLICY,
        # Va pegado a la política de investigación: es su contrapeso. Aquella
        # prohíbe responder sin fuentes y esta impide que esa prohibición se
        # convierta en "no encontré nada" a la primera.
        RESOURCEFULNESS,
        DATE_POLICY,
        LANGUAGE_POLICY,
        VOICE_GUIDE,
    ]
    if web_enabled:
        bloques.append(DOCTRINAL_POLICY)
    bloques += [mode.prompt, CITATION_CONTRACT, TOOL_CATALOG]
    return "\n\n".join(bloques)


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


#: Qué se le dice al usuario cuando el modelo cierra el stream sin escribir una
#: sola palabra, ni siquiera en el reintento. Accionable, porque él SÍ puede
#: hacer algo: bajar el esfuerzo o elegir un modo con más espacio.
_EMPTY_ANSWER_MESSAGE = (
    "El modelo terminó sin escribir la respuesta. La investigación se hizo, "
    "pero se quedó sin espacio para redactar: prueba a bajar el esfuerzo de "
    "razonamiento en Ajustes de IA, o vuelve a intentarlo."
)

#: Mensaje del 503 cuando no hay ni key de cliente ni de servidor. Accionable:
#: dice exactamente qué hacer, porque el usuario SÍ puede arreglarlo.
NO_KEY_MESSAGE = (
    "No hay ninguna API key configurada. Añade la tuya en Más → Ajustes de IA."
)


class ChatService:
    """
    Servicio de chat IA con MCP tools.

    El servicio ya NO tiene cliente propio: el proveedor, el modelo y la key
    llegan por petición en un ``ChatRuntime`` (ver chat_providers). Lo único
    que sobrevive entre peticiones es el catálogo de herramientas, que es caro
    de cargar y no depende de quién pregunte.
    """

    def __init__(self):
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

    def tools_for(self, config: Optional[ResearchConfig] = None) -> list[Dict[str, Any]]:
        """
        Catálogo que se le ofrece al modelo en ESTA petición.

        ``self.tools`` es el suelo común (nativas + MCP) y se cachea porque es
        caro de cargar; la de internet se añade encima solo si el usuario la
        activó. Meterla en el catálogo cacheado la encendería para todos.
        """
        if config is None or not config.internet:
            return self.tools
        return [*tools_for(config), *self.mcp_tools]

    async def _run_tool(
        self,
        name: str,
        args: Dict[str, Any],
        config: Optional[ResearchConfig] = None,
    ) -> str:
        """Ejecuta una herramienta (nativa o MCP) y devuelve su resultado en JSON."""
        try:
            if is_native_tool(name):
                result = await asyncio.to_thread(call_native_tool, name, args, config)
            else:
                bridge = get_mcp_bridge()
                result = await asyncio.to_thread(bridge.call_tool, name, args)
            return json.dumps(result, ensure_ascii=False)
        except Exception as exc:
            logger.error("Error ejecutando herramienta %s: %s", name, redact(exc))
            return json.dumps({"error": "tool execution failed"})

    async def _generate_followups(
        self,
        runtime: ChatRuntime,
        full_messages: list[Dict[str, Any]],
        answer: str,
        mode: ModeSpec,
    ) -> List[str]:
        """
        Sugerencias de continuación. Llamada corta, sin tools, sin streaming.

        Si algo falla (o están desactivadas) se usan las estáticas del modo: no
        merece la pena arriesgar el turno por tres chips.
        """
        if not CHAT_FOLLOWUPS or not answer.strip():
            return list(mode.followups)[:3]

        try:
            response = await runtime.client.chat.completions.create(
                model=runtime.model,
                messages=[
                    *full_messages,
                    {"role": "assistant", "content": answer},
                    {"role": "user", "content": _FOLLOWUPS_PROMPT},
                ],
                max_completion_tokens=200,
                **runtime.tool_params,
            )
        except Exception as exc:
            logger.warning("No se pudieron generar sugerencias: %s", redact(exc))
            return list(mode.followups)[:3]

        raw = response.choices[0].message.content or ""
        return parse_followups(raw, mode.followups)

    async def chat_stream(
        self,
        messages: list[Dict[str, str]],
        mode: Optional[str] = None,
        runtime: Optional[ChatRuntime] = None,
        config: Optional[ResearchConfig] = None,
        local_snippets: Optional[Sequence[LocalSnippet]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Genera una respuesta de chat con streaming SSE.

        Args:
            messages: lista de mensajes {role, content}
            mode: id del modo de redacción; desconocido o None → modo por defecto
            runtime: proveedor/modelo/esfuerzo de ESTA petición. Si es ``None``
                se usa el del servidor (las env vars de siempre), que es lo que
                hace un cliente antiguo que no manda nada.
            config: ajustes de investigación del usuario. En el chat normal se
                usa ``offline()``: internet es cosa de la investigación
                profunda, no de una pregunta suelta de treinta segundos.
            local_snippets: fragmentos de las publicaciones .jwpub que el
                usuario tiene en su dispositivo y ha autorizado (ver
                local_library.py). Vacío o ``None`` = el chat de siempre.

        Yields:
            Eventos SSE formateados (event: type\\ndata: json\\n\\n)
        """
        start_time = time.time()

        if runtime is None:
            runtime = server_runtime()
        if runtime is None:
            for event in self._fail(NO_KEY_MESSAGE, 0, start_time):
                yield event
            return

        await self.ensure_tools()

        settings = config or ResearchConfig.offline()
        tools = self.tools_for(settings)
        mode_spec = get_mode(mode)

        # Los libros del usuario entran como un mensaje de sistema propio, justo
        # detrás del prompt y ANTES de la conversación: así el modelo ya los
        # tiene delante en la primera ronda de herramientas y puede buscar para
        # completarlos, en vez de descubrirlos cuando ya decidió qué mirar.
        #
        # Mensaje aparte y no pegado al system prompt a propósito: esto es
        # contenido que cambia en cada turno y lo trae el cliente, así que no
        # debe mezclarse con las instrucciones del sistema, que son fijas.
        prefacio: list[Dict[str, Any]] = [
            {
                "role": "system",
                "content": build_system_prompt(mode_spec, settings.internet),
            }
        ]
        contexto_local = build_context_message(local_snippets or [])
        if contexto_local:
            prefacio.append({"role": "system", "content": contexto_local})

        full_messages: list[Dict[str, Any]] = prefacio + list(messages)

        total_tokens = 0
        total_tool_calls = 0
        tracker = SourceTracker()
        # Se registran ANTES del bucle: aunque el modelo no llame a ninguna
        # herramienta, estas fuentes se consultaron —el usuario las puso sobre
        # la mesa— y tienen que salir en los chips igualmente.
        tracker.record_local_library(local_snippets or [])
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
        if tools:
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
                # Donde el proveedor no admite "required" (Gemini) se degrada a
                # "auto" y el cierre de brechas hace el trabajo.
                tool_choice = tool_choice_for(runtime.provider, force_tools)
                force_tools = False
                try:
                    response = await runtime.client.chat.completions.create(
                        model=runtime.model,
                        messages=full_messages,
                        tools=tools,
                        tool_choice=tool_choice,
                        max_completion_tokens=OPENAI_MAX_TOKENS,
                        **runtime.tool_params,
                    )
                except Exception as exc:
                    logger.error(
                        "Llamada al proveedor fallida (ronda de tools %s): %s",
                        round_idx,
                        redact(exc),
                    )
                    for event in self._fail(
                        provider_error_message(runtime.provider, exc),
                        total_tokens,
                        start_time,
                    ):
                        yield event
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
                # Se devuelve el mensaje COMPLETO, con lo que el proveedor
                # haya añadido. Reconstruirlo a mano borraba la firma de
                # pensamiento de Gemini 3 y su segunda ronda daba 400.
                full_messages.append(echo_assistant_message(message))

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
                        content = await self._run_tool(
                            tool_name, tool_args, settings
                        )
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

        # FUERA del `if tools:` a propósito. Sin herramientas (el MCP caído
        # y las nativas desactivadas) no hay fuentes que enviar, pero el
        # `metadata` sigue haciendo falta: es lo que se persiste con el mensaje
        # y lo que pinta el pie "modelo · esfuerzo". Dentro del `if`, esas
        # respuestas se guardaban sin `meta` y releerlas no decía quién las
        # había escrito.
        yield self._format_sse("sources", {"items": tracker.sources()})
        # Aditivo: los campos nuevos (provider, effort, effort_applied) los
        # ignora un cliente antiguo sin enterarse.
        yield self._format_sse(
            "metadata",
            {
                "tool_calls": total_tool_calls,
                "mode": mode_spec.id,
                **runtime.metadata(),
            },
        )

        # ─── Ronda final: respuesta en streaming SIN tools ────────────
        #
        # Dos pasadas como máximo. La segunda solo ocurre si la primera no
        # escribió NADA, y va con el esfuerzo mínimo del proveedor y con
        # holgura de sobra: el caso real era un Gemini con esfuerzo alto que se
        # gastaba los 900 tokens del modo "comentario" pensando y cerraba el
        # stream vacío. Insistir con los mismos parámetros habría dado lo mismo.
        visible_cap = min(OPENAI_MAX_TOKENS, mode_spec.max_tokens)
        pasadas: list[tuple[Dict[str, Any], int]] = [
            (runtime.answer_params, runtime.answer_cap(visible_cap)),
        ]
        rescate = runtime.retry_params()
        if rescate != runtime.answer_params:
            pasadas.append((rescate, visible_cap + RETRY_RESERVE))

        answer = ""
        for intento, (params, cap) in enumerate(pasadas, start=1):
            # MiniMax escribe su razonamiento dentro del contenido; sin esto el
            # usuario ve el monólogo interno delante de su comentario.
            limpiador = ReasoningStripper(runtime.provider.inline_reasoning)
            motivo: Optional[str] = None
            try:
                final_stream = await runtime.client.chat.completions.create(
                    model=runtime.model,
                    messages=full_messages,
                    max_completion_tokens=cap,
                    stream=True,
                    stream_options={"include_usage": True},
                    **params,
                )
                async for chunk in final_stream:
                    if getattr(chunk, "usage", None):
                        total_tokens += chunk.usage.total_tokens
                    if not chunk.choices:
                        continue
                    # Por qué paró el modelo. Es el único dato que distingue
                    # "se quedó sin tokens" de "no tenía nada que decir", y sin
                    # él el fallo no se puede diagnosticar desde los logs.
                    motivo = getattr(chunk.choices[0], "finish_reason", None) or motivo
                    delta = chunk.choices[0].delta
                    if delta.content:
                        visible = limpiador.feed(delta.content)
                        if visible:
                            answer += visible
                            yield self._format_sse("token", {"text": visible})
            except Exception as exc:
                logger.error("Stream fallido (respuesta final): %s", redact(exc))
                for event in self._fail(
                    "Error al generar la respuesta final", total_tokens, start_time
                ):
                    yield event
                return

            cola = limpiador.flush()
            if cola:
                answer += cola
                yield self._format_sse("token", {"text": cola})

            if answer.strip():
                break

            logger.warning(
                "Redacción vacía (intento %s/%s): modelo=%s finish_reason=%s "
                "tope=%s params=%s",
                intento,
                len(pasadas),
                runtime.model,
                motivo,
                cap,
                params,
            )

        if not answer.strip():
            # Nunca un `done` limpio con las manos vacías: el cliente lo daba
            # por bueno, no guardaba mensaje y borraba el rastro de la
            # investigación, así que la pantalla quedaba como si el usuario no
            # hubiera preguntado nada.
            for event in self._fail(_EMPTY_ANSWER_MESSAGE, total_tokens, start_time):
                yield event
            return

        suggestions = await self._generate_followups(
            runtime, full_messages, answer, mode_spec
        )
        if suggestions:
            yield self._format_sse("suggestions", {"items": suggestions})

        elapsed_ms = int((time.time() - start_time) * 1000)
        yield self._format_sse(
            "done", {"total_tokens": total_tokens, "elapsed_ms": elapsed_ms}
        )

    def _format_sse(self, event: str, data: Dict[str, Any]) -> str:
        """Formatea un evento SSE."""
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    def _fail(
        self, message: str, total_tokens: int, start_time: float
    ) -> Iterator[str]:
        """
        Aborta el turno: un ``error`` y, SIEMPRE, un ``done``.

        El ``done`` no es decorativo. Es la única señal de "esto se ha acabado"
        que tiene el cliente; cortar el stream sin él deja al consumidor
        esperando un final que no llega. ``research_service`` y el propio
        ``chat_router`` ya cerraban así, y estas dos ramas no.
        """
        yield self._format_sse("error", {"message": message})
        yield self._format_sse(
            "done",
            {
                "total_tokens": total_tokens,
                "elapsed_ms": int((time.time() - start_time) * 1000),
            },
        )


# Singleton
_service: Optional[ChatService] = None


def get_chat_service() -> ChatService:
    """
    Obtiene el singleton del chat service.

    Ya NO lanza si falta la key: el servicio es utilizable con la key que traiga
    el cliente en la cabecera. Quién puede responder y quién no lo decide el
    router, que es el que ve la petición.
    """
    global _service
    if _service is None:
        _service = ChatService()
    return _service


__all__ = [
    "ChatService",
    "get_chat_service",
    "build_system_prompt",
    "parse_followups",
    "build_runtime",
    "server_runtime",
    "NO_KEY_MESSAGE",
    "SYSTEM_PROMPT",
    "CHAT_MODES",
    "DEFAULT_MODE",
    "get_mode",
    "list_modes",
    "OPENAI_MODEL",
]
