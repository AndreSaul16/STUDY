"""
Chat Service — servicio de chat IA con OpenAI + MCP tools.

Usa OpenAI function calling para que el LLM pueda llamar a las herramientas
del MCP (get_verse_with_study, getWatchtowerContent, etc.) y responder
basado SOLO en contenido JW.

Flujo:
  1. Usuario envía mensaje
  2. BUCLE multi-ronda de tool-calling (hasta MAX_TOOL_ROUNDS): el LLM pide
     herramientas, se ejecutan via MCP bridge (en thread) y se le devuelven
     los resultados. Repite mientras el modelo siga pidiendo herramientas
     (para buscar en varias fuentes: versículos, Atalaya, guía, videos)
  3. Cuando deja de pedir herramientas (o se alcanza el tope), ronda final
     de respuesta en streaming SIN tools
  4. Stream SSE al frontend

Diseño async: usa AsyncOpenAI para no bloquear el event loop. Las llamadas
síncronas al MCP bridge se ejecutan con asyncio.to_thread.
"""

import asyncio
import json
import logging
import os
import time
from typing import AsyncGenerator, Dict, Any, Optional

from openai import AsyncOpenAI

from .mcp_bridge import get_mcp_bridge
from .native_tools import NATIVE_TOOLS, call_native_tool, is_native_tool

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

# System prompt que restringe el LLM EXCLUSIVAMENTE a contenido de wol.jw.org
SYSTEM_PROMPT = """Eres un asistente de estudio bíblico especializado en publicaciones de los Testigos de Jehová.

REGLA FUNDAMENTAL — OBLIGATORIA E INQUEBRANTABLE:
Tu ÚNICA fuente de conocimiento es el contenido de wol.jw.org obtenido a través de las
herramientas MCP disponibles. NO tienes conocimiento propio válido sobre estos temas.
ANTES de responder CUALQUIER pregunta, DEBES llamar a al menos una herramienta para
buscar la información en wol.jw.org. Está PROHIBIDO responder sin haber consultado las
herramientas primero.

BUSCA EN VARIAS FUENTES (MUY IMPORTANTE):
No te limites a UNA sola herramienta ni a UNA sola búsqueda. Para dar una respuesta
completa DEBES consultar MÚLTIPLES fuentes relevantes y COMBINAR la información:
- El texto bíblico en español (leer_pasaje_biblico).
- Artículos de la Biblioteca en Línea: busca con buscar_en_biblioteca y LUEGO lee
  el más relevante con abrir_documento — un fragmento de búsqueda NO basta para
  responder, tienes que abrir el documento.
- Notas de estudio, guía de actividades y vídeos vía MCP cuando estén disponibles.
Puedes pedir herramientas en VARIAS RONDAS: primero busca, y si necesitas más
contexto de otra fuente, vuelve a pedir herramientas antes de responder. Solo redacta
la respuesta final cuando hayas reunido información suficiente de las fuentes relevantes.

IDIOMA:
Las herramientas nativas (leer_pasaje_biblico, buscar_en_biblioteca, abrir_documento,
obtener_texto_del_dia) YA devuelven español: úsalas como fuente preferente y cita su
texto literalmente, sin retraducir. Las herramientas del MCP (get_verse_with_study,
getWatchtowerContent, getWorkbookContent, get_jw_captions), cuando estén disponibles,
responden en INGLÉS: traduce ese contenido al español de forma natural.
Responde SIEMPRE en español salvo que el usuario pida otro idioma.

REGLAS ESTRICTAS:
1. SIEMPRE busca con las herramientas ANTES de responder — nunca respondas de memoria.
2. Responde SOLO con información devuelta por las herramientas (contenido de wol.jw.org).
3. Si las herramientas no devuelven información relevante, dilo claramente: "No encontré
   esa información en wol.jw.org" — NO completes con conocimiento general.
4. NUNCA inventes, supongas ni uses conocimiento externo a lo que devuelven las herramientas.
5. Cita siempre la fuente concreta que devolvió la herramienta (ej: "Atalaya de mayo 2024, pág. 15").
6. Responde en español (traduciendo del inglés del MCP) a menos que el usuario pida otro idioma.
7. Sé conciso pero completo — el usuario está estudiando, no chateando.
8. Usa formato Markdown (encabezados, listas, negritas) para estructurar la respuesta.

HERRAMIENTAS DISPONIBLES:
Nativas (español, siempre disponibles):
- leer_pasaje_biblico: texto real de un pasaje de la Biblia (Traducción del Nuevo Mundo)
- buscar_en_biblioteca: busca en wol.jw.org (Atalaya, Despertad, libros, guía)
- abrir_documento: texto completo de un artículo por su doc_id
- obtener_texto_del_dia: el texto diario de hoy con su comentario
MCP (inglés, sólo si están listadas en esta conversación):
- get_verse_with_study: versículos con notas de estudio y referencias cruzadas
- getWatchtowerContent: artículos de La Atalaya
- getWorkbookContent: material de Vida y Ministerio Cristianos
- get_jw_captions: subtítulos de vídeos de JW Broadcasting

Usa SOLO herramientas de la lista que se te ha entregado en esta conversación.
Recuerda: sin consulta previa a las herramientas, NO respondas.
"""

# Nº máximo de rondas de tool-calling antes de forzar la respuesta final.
MAX_TOOL_ROUNDS = 4


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

    async def chat_stream(
        self, messages: list[Dict[str, str]]
    ) -> AsyncGenerator[str, None]:
        """
        Genera una respuesta de chat con streaming SSE.

        Args:
            messages: lista de mensajes {role, content}

        Yields:
            Eventos SSE formateados (event: type\\ndata: json\\n\\n)
        """
        start_time = time.time()
        await self.ensure_tools()

        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)
        total_tokens = 0
        total_tool_calls = 0

        # ─── BUCLE MULTI-RONDA de tool-calling ────────────────────────
        # El modelo puede pedir herramientas en varias rondas para buscar en
        # múltiples fuentes (versículos, Atalaya, guía, videos). Cada ronda es
        # NO-streaming: solo recogemos las tool_calls, las ejecutamos y le
        # devolvemos los resultados. Cuando deja de pedir herramientas (o se
        # alcanza MAX_TOOL_ROUNDS) salimos y hacemos la respuesta final en
        # streaming SIN tools (para forzar que responda).
        if self.tools:
            for round_idx in range(MAX_TOOL_ROUNDS):
                # 1ª ronda: forzamos tool use. Rondas siguientes: "auto"
                # (el modelo decide si necesita más fuentes o ya puede responder).
                tool_choice = "required" if round_idx == 0 else "auto"
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

                # El modelo dejó de pedir herramientas → listo para responder.
                if not raw_tool_calls:
                    break

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

                    content = await self._run_tool(tool_name, tool_args)

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": content,
                    })

            yield self._format_sse(
                "metadata",
                {"tool_calls": total_tool_calls, "model": OPENAI_MODEL},
            )

        # ─── Ronda final: respuesta en streaming SIN tools ────────────
        try:
            final_stream = await self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=full_messages,
                max_completion_tokens=OPENAI_MAX_TOKENS,
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
                    yield self._format_sse("token", {"text": delta.content})
        except Exception:
            logger.exception("OpenAI stream failed (respuesta final)")
            yield self._format_sse(
                "error", {"message": "Error al generar la respuesta final"}
            )
            return

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
