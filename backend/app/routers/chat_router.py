"""
Chat Router — endpoints para el chat IA con OpenAI + MCP.

POST /api/chat/stream   — chat con streaming SSE
GET  /api/chat/health   — health check del chat service
GET  /api/chat/tools    — lista de herramientas MCP disponibles
"""
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from ..schemas.chat_schemas import (
    ChatRequest,
    ChatHealthResponse,
)
from ..services.ai.chat_service import get_chat_service, ChatService


router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """
    Endpoint de chat con streaming SSE.

    Recibe una lista de mensajes y devuelve un stream de eventos SSE:
      - event: metadata    → información inicial (model, tool_calls count)
      - event: tool_call   → el LLM llamó una herramienta MCP
      - event: token       → token de texto de la respuesta
      - event: done        → fin del stream con stats
      - event: error       → error durante el proceso
    """
    try:
        service = get_chat_service()
    except ValueError as e:
        raise HTTPException(503, str(e))

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    async def event_generator():
        async for event in service.chat_stream(messages):
            yield event

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
        return ChatHealthResponse(
            healthy=True,
            provider="openai",
            model=service.client._custom_headers.get("model", "gpt-4o-mini"),
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


@router.get("/tools")
async def list_tools():
    """Lista las herramientas MCP disponibles para el chat."""
    try:
        service = get_chat_service()
        return {"tools": service.mcp_tools}
    except ValueError as e:
        raise HTTPException(503, str(e))
