"""
Chat Router — endpoints para el chat IA con OpenAI/Google + MCP.

POST /api/chat/stream   — chat con streaming SSE
GET  /api/chat/health   — health check del chat service
GET  /api/chat/tools    — lista de herramientas MCP disponibles
GET  /api/chat/modes    — catálogo de modos de redacción

La API key del usuario (BYOK) llega SOLO por la cabecera ``X-AI-Api-Key``:
nunca por query string (quedaría en los logs de Railway y en el historial del
navegador) y nunca por el cuerpo persistido. Se usa para construir el runtime
de esta petición y se descarta. El backend no la guarda, no la loguea y no la
devuelve en ninguna respuesta.
"""
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..schemas.chat_schemas import (
    ChatRequest,
    ChatHealthResponse,
    ChatModesResponse,
)
from ..services.ai.chat_modes import DEFAULT_MODE, list_modes
from ..services.ai.chat_providers import (
    build_runtime,
    has_server_key,
    is_usable_key,
    server_provider_id,
    server_runtime,
)
from ..services.ai.chat_service import NO_KEY_MESSAGE, get_chat_service

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/chat", tags=["chat"])

#: Cabecera por la que viaja la key del usuario. Ver ADR-3 del plan.
API_KEY_HEADER = "X-AI-Api-Key"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "si", "sí", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _resolve_runtime(request: Request, chat_request: ChatRequest):
    """
    Runtime de esta petición.

    Con key de cliente → BYOK. Sin ella → el runtime del servidor, que es
    exactamente el comportamiento de siempre (compatibilidad total con el
    cliente ya desplegado, que no manda ni cabecera ni campos nuevos).
    """
    client_key = (request.headers.get(API_KEY_HEADER) or "").strip()

    if is_usable_key(client_key):
        return build_runtime(
            chat_request.provider,
            client_key,
            model=chat_request.model,
            effort=chat_request.effort,
            source="client",
        )

    if _env_bool("CHAT_REQUIRE_CLIENT_KEY", False):
        raise HTTPException(
            428, "Configura tu API key en Más → Ajustes de IA para usar el chat."
        )

    # En modo servidor el modelo y el esfuerzo del cliente se respetan salvo
    # que se desactive explícitamente: es la misma cuenta, y quien abre la app
    # debe poder elegir "rápido y barato" para una pregunta tonta.
    allow_client_model = _env_bool("CHAT_ALLOW_CLIENT_MODEL", True)
    runtime = server_runtime(
        model=chat_request.model if allow_client_model else None,
        effort=chat_request.effort if allow_client_model else None,
    )
    if runtime is None:
        raise HTTPException(503, NO_KEY_MESSAGE)
    return runtime


@router.post("/stream")
async def chat_stream(chat_request: ChatRequest, request: Request):
    """
    Endpoint de chat con streaming SSE.

    Recibe una lista de mensajes y devuelve un stream de eventos SSE:
      - event: tool_call   → el LLM llamó una herramienta
      - event: tool_result → resumen de lo que devolvió esa herramienta
      - event: sources     → fuentes consultadas, con doc_id/identifier/url
      - event: metadata    → provider, model, effort aplicado, modo, tool_calls
      - event: token       → token de texto de la respuesta
      - event: suggestions → 3 preguntas de continuación
      - event: done        → fin del stream con stats
      - event: error       → error durante el proceso
    """
    service = get_chat_service()
    runtime = _resolve_runtime(request, chat_request)

    messages = [{"role": m.role, "content": m.content} for m in chat_request.messages]

    async def event_generator():
        try:
            async for event in service.chat_stream(
                messages, mode=chat_request.mode, runtime=runtime
            ):
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
    """
    Health check del chat service.

    ``has_server_key`` dice si el backend puede responder sin que el usuario
    traiga la suya. Es un booleano: la key NO se devuelve, ni truncada.
    """
    server = server_runtime()
    try:
        service = get_chat_service()
        await service.ensure_tools()
        return ChatHealthResponse(
            healthy=True,
            provider=server.provider.id if server else server_provider_id(),
            model=server.model if server else "none",
            mcp_tools_count=len(service.mcp_tools),
            has_server_key=has_server_key(),
        )
    except Exception as e:
        return ChatHealthResponse(
            healthy=False,
            provider="error",
            model="error",
            mcp_tools_count=0,
            has_server_key=has_server_key(),
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
    service = get_chat_service()
    await service.ensure_tools()
    return {
        "tools": service.tools,
        "native_count": len(service.tools) - len(service.mcp_tools),
        "mcp_count": len(service.mcp_tools),
    }
