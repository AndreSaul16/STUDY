"""
Chat Router — endpoints para el chat IA con OpenAI + MCP.

POST /api/chat/stream   — chat con streaming SSE
GET  /api/chat/health   — health check del chat service
GET  /api/chat/tools    — lista de herramientas MCP disponibles
GET  /api/chat/modes    — catálogo de modos de redacción
"""
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..schemas.chat_schemas import (
    ChatRequest,
    ChatHealthResponse,
    ChatModesResponse,
)
from ..services.ai.chat_modes import DEFAULT_MODE, list_modes
from ..services.ai.chat_service import get_chat_service, OPENAI_MODEL

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/stream")
async def chat_stream(chat_request: ChatRequest, request: Request):
    """
    Endpoint de chat con streaming SSE.

    Recibe una lista de mensajes y devuelve un stream de eventos SSE:
      - event: tool_call   → el LLM llamó una herramienta
      - event: tool_result → resumen de lo que devolvió esa herramienta
      - event: sources     → fuentes consultadas, con doc_id/identifier/url
      - event: metadata    → model, tool_calls count, modo aplicado
      - event: token       → token de texto de la respuesta
      - event: suggestions → 3 preguntas de continuación
      - event: done        → fin del stream con stats
      - event: error       → error durante el proceso
    """
    try:
        service = get_chat_service()
    except ValueError as e:
        raise HTTPException(503, str(e))

    messages = [{"role": m.role, "content": m.content} for m in chat_request.messages]

    async def event_generator():
        try:
            async for event in service.chat_stream(messages, mode=chat_request.mode):
                if await request.is_disconnected():
                    return
                yield event
        except Exception:
            logger.exception("Error en el stream de chat")
            yield 'event: error\ndata: {"message": "Error interno del servidor"}\n\n'
            yield 'event: done\ndata: {"total_tokens": 0, "elapsed_ms": 0}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/health", response_model=ChatHealthResponse)
async def chat_health():
    """Health check del chat service."""
    try:
        service = get_chat_service()
        await service.ensure_tools()
        return ChatHealthResponse(
            healthy=True,
            provider="openai",
            model=OPENAI_MODEL,
            mcp_tools_count=len(service.mcp_tools),
        )
    except ValueError as e:
        return ChatHealthResponse(
            healthy=False,
            provider="none",
            model="none",
            mcp_tools_count=0,
            error=str(e),
        )
    except Exception as e:
        return ChatHealthResponse(
            healthy=False,
            provider="error",
            model="error",
            mcp_tools_count=0,
            error=str(e),
        )


@router.get("/modes", response_model=ChatModesResponse)
async def chat_modes():
    """
    Catálogo de modos de redacción.

    NO llama a get_chat_service() a propósito: el selector de modos de la
    interfaz tiene que poder pintarse aunque falte OPENAI_API_KEY o el
    proveedor esté caído. Es un catálogo estático, no depende del proveedor.
    """
    return ChatModesResponse(modes=list_modes(), default=DEFAULT_MODE)


@router.get("/tools")
async def list_tools():
    """Lista todas las herramientas del chat (nativas + MCP)."""
    try:
        service = get_chat_service()
        await service.ensure_tools()
        return {
            "tools": service.tools,
            "native_count": len(service.tools) - len(service.mcp_tools),
            "mcp_count": len(service.mcp_tools),
        }
    except ValueError as e:
        raise HTTPException(503, str(e))
