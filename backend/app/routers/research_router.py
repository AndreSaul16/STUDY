"""
Research Router — investigación profunda en segundo plano.

POST /api/research/start        → { job_id, estimated_seconds }
GET  /api/research/stream/{id}  → SSE reanudable (cabecera Last-Event-ID)
GET  /api/research/{id}         → instantánea JSON (polling de respaldo)
POST /api/research/{id}/cancel  → 204

Un informe tarda minutos: si fuera una sola petición HTTP, cualquier proxy la
cortaría por inactividad y el móvil la perdería al bloquear la pantalla. Por
eso el trabajo vive en el servidor y el cliente se engancha y se desengancha.

Los trabajos están en memoria: un redeploy los mata. Es una limitación asumida,
y la mitigación vive en el cliente — cada evento va numerado, el cliente los
persiste y ofrece "Reanudar" si el trabajo ya no existe (404).
"""

import logging

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from typing import Optional

from ..schemas.chat_schemas import ChatRequest
from ..services.ai.chat_service import get_chat_service
from ..services.ai.research_service import (
    JobLimitReached,
    estimated_seconds,
    get_registry,
    start_job,
    stream_job,
)
from .chat_router import _resolve_research, _resolve_runtime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research", tags=["research"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _last_event_id(raw: Optional[str]) -> int:
    try:
        return max(0, int(str(raw or "0").strip()))
    except ValueError:
        return 0


@router.post("/start")
async def start(chat_request: ChatRequest, request: Request):
    """Arranca una investigación y devuelve su id inmediatamente."""
    service = get_chat_service()
    runtime = _resolve_runtime(request, chat_request)

    messages = [{"role": m.role, "content": m.content} for m in chat_request.messages]

    try:
        job = start_job(
            service,
            runtime,
            messages,
            chat_request.mode,
            chat_request.conversation_id,
            # Este endpoint ES la investigación profunda, así que internet se
            # respeta tal como venga del cliente en vez de apagarse.
            _resolve_research(chat_request, deep=True),
        )
    except JobLimitReached as exc:
        raise HTTPException(429, str(exc))

    return {"job_id": job.job_id, "estimated_seconds": estimated_seconds()}


@router.get("/stream/{job_id}")
async def stream(
    job_id: str,
    last_event_id: Optional[str] = Header(default=None, alias="Last-Event-ID"),
):
    """
    SSE del trabajo, reanudable.

    Con ``Last-Event-ID: 7`` se reemite desde el 8: reconectar tras un túnel no
    cuesta ni un evento ni una investigación repetida.
    """
    job = get_registry().get(job_id)
    if job is None:
        raise HTTPException(404, "Esa investigación ya no existe. Puedes reanudarla.")

    return StreamingResponse(
        stream_job(job, _last_event_id(last_event_id)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.get("/{job_id}")
async def snapshot(job_id: str):
    """Estado completo. Polling de respaldo donde el SSE no llega."""
    job = get_registry().get(job_id)
    if job is None:
        raise HTTPException(404, "Esa investigación ya no existe. Puedes reanudarla.")
    return job.snapshot()


@router.post("/{job_id}/cancel", status_code=204)
async def cancel(job_id: str) -> Response:
    """Cancela. Idempotente: cancelar dos veces no es un error del usuario."""
    if get_registry().get(job_id) is None:
        raise HTTPException(404, "Esa investigación ya no existe.")
    get_registry().cancel(job_id)
    return Response(status_code=204)


__all__ = ["router"]
