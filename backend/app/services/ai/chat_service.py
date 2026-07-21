"""
Chat Service — servicio de chat IA con OpenAI + MCP tools.

Usa OpenAI function calling para que el LLM pueda llamar a las herramientas
del MCP (get_verse_with_study, getWatchtowerContent, etc.) y responder
basado SOLO en contenido JW.

Flujo:
  1. Usuario envía mensaje
  2. LLM decide qué herramientas del MCP usar (function calling)
  3. Backend ejecuta las herramientas via MCP bridge
  4. LLM compone respuesta basada en los resultados
  5. Stream SSE al frontend
"""

import json
import os
import time
from typing import AsyncGenerator, Dict, Any, Optional
from openai import OpenAI
from .mcp_bridge import get_mcp_bridge


# Configuración OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "2000"))

# System prompt que restringe el LLM a contenido JW
SYSTEM_PROMPT = """Eres un asistente de estudio bíblico especializado en publicaciones de los Testigos de Jehová.

REGLAS ESTRICTAS:
1. Responde SOLO basándote en información de publicaciones JW (Biblia, Atalaya, Despertad, libros, etc.)
2. Usa las herramientas disponibles para buscar información en wol.jw.org y las publicaciones
3. Si no encuentras información relevante en las fuentes JW, dilo claramente
4. NUNCA inventes información ni uses conocimiento general fuera de las fuentes JW
5. Cita siempre la fuente cuando sea posible (ej: "Atalaya de mayo 2024, pág. 15")
6. Responde en español a menos que el usuario pida otro idioma
7. Sé conciso pero completo — el usuario está estudiando, no chateando

HERRAMIENTAS DISPONIBLES:
- get_verse_with_study: obtiene versículos bíblicos con notas de estudio y referencias cruzadas
- getWatchtowerContent: obtiene artículos de La Atalaya
- getWorkbookContent: obtiene material del libro de actividades Vida y Ministerio Cristianos
- get_jw_captions: obtiene subtítulos de videos de JW Broadcasting

Usa estas herramientas para buscar información relevante antes de responder.
"""


class ChatService:
    """Servicio de chat IA con OpenAI + MCP tools."""

    def __init__(self):
        if not OPENAI_API_KEY or OPENAI_API_KEY == "sk-your-api-key-here":
            raise ValueError(
                "OPENAI_API_KEY no configurada. Añádela en backend/.env"
            )
        self.client = OpenAI(api_key=OPENAI_API_KEY)
        self.mcp_tools: list[Dict[str, Any]] = []
        self._load_mcp_tools()

    def _load_mcp_tools(self) -> None:
        """Carga las herramientas del MCP y las convierte a formato OpenAI."""
        try:
            bridge = get_mcp_bridge()
            tools = bridge.list_tools()

            # Convertir herramientas MCP a formato OpenAI function calling
            self.mcp_tools = []
            for tool in tools:
                self.mcp_tools.append({
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("inputSchema", {}),
                    },
                })
        except Exception as e:
            print(f"[ChatService] Error cargando MCP tools: {e}")
            self.mcp_tools = []

    async def chat_stream(
        self, messages: list[Dict[str, str]]
    ) -> AsyncGenerator[str, None]:
        """
        Genera una respuesta de chat con streaming SSE.

        Args:
            messages: lista de mensajes {role, content}

        Yields:
            Eventos SSE formateados (event: type\ndata: json\n\n)
        """
        start_time = time.time()

        # Preparar mensajes con system prompt
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        # Primera llamada al LLM
        try:
            response = self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=full_messages,
                tools=self.mcp_tools if self.mcp_tools else None,
                max_tokens=OPENAI_MAX_TOKENS,
                stream=False,  # No streaming para function calling
            )
        except Exception as e:
            yield self._format_sse("error", {"message": str(e)})
            return

        choice = response.choices[0]
        message = choice.message

        # Si el LLM quiere llamar herramientas
        if message.tool_calls:
            # Enviar metadata
            yield self._format_sse("metadata", {
                "tool_calls": len(message.tool_calls),
                "model": OPENAI_MODEL,
            })

            # Ejecutar cada tool call
            tool_results = []
            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)

                yield self._format_sse("tool_call", {
                    "name": tool_name,
                    "arguments": tool_args,
                })

                # Ejecutar herramienta via MCP
                try:
                    bridge = get_mcp_bridge()
                    result = bridge.call_tool(tool_name, tool_args)
                    tool_results.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "content": json.dumps(result),
                    })
                except Exception as e:
                    tool_results.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "content": json.dumps({"error": str(e)}),
                    })

            # Segunda llamada al LLM con resultados de herramientas
            full_messages.append(message.model_dump())
            full_messages.extend(tool_results)

            try:
                response2 = self.client.chat.completions.create(
                    model=OPENAI_MODEL,
                    messages=full_messages,
                    max_tokens=OPENAI_MAX_TOKENS,
                    stream=True,
                )
            except Exception as e:
                yield self._format_sse("error", {"message": str(e)})
                return

            # Stream de la respuesta final
            full_content = ""
            for chunk in response2:
                if chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_content += token
                    yield self._format_sse("token", {"text": token})

        else:
            # Respuesta directa sin tool calls — stream
            # Rehacer con streaming
            try:
                response_stream = self.client.chat.completions.create(
                    model=OPENAI_MODEL,
                    messages=full_messages,
                    tools=self.mcp_tools if self.mcp_tools else None,
                    max_tokens=OPENAI_MAX_TOKENS,
                    stream=True,
                )
            except Exception as e:
                yield self._format_sse("error", {"message": str(e)})
                return

            full_content = ""
            for chunk in response_stream:
                if chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_content += token
                    yield self._format_sse("token", {"text": token})

        elapsed_ms = int((time.time() - start_time) * 1000)
        yield self._format_sse("done", {
            "total_tokens": response.usage.total_tokens if response.usage else 0,
            "elapsed_ms": elapsed_ms,
        })

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
