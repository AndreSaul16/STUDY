"""
Offline Router — descarga la Biblia entera a la caché de disco.

POST /api/offline/bible/start   → { job_id, total, pending, estimated_seconds }
GET  /api/offline/status        → cuántos capítulos hay ya descargados
GET  /api/offline/stream/{id}   → SSE reanudable (cabecera Last-Event-ID)
GET  /api/offline/{id}          → instantánea JSON (polling de respaldo)
POST /api/offline/{id}/cancel   → 204

Una descarga completa son decenas de minutos: si fuera una sola petición HTTP,
cualquier proxy la cortaría por inactividad y el móvil la perdería al bloquear
la pantalla. Por eso el trabajo vive en el servidor y el cliente se engancha y
se desengancha, igual que la investigación profunda.

Los trabajos están en memoria y un redeploy los mata, pero aquí apenas duele:
lo descargado queda en la caché de disco y relanzar se salta todo eso.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services.jw.offline_library import (
    JobLimitReached,
    chapter_targets,
    estimated_seconds,
    get_registry,
    is_cached,
    library_status,
    start_job,
    stream_job,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/offline", tags=["offline"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class BibleDownloadRequest(BaseModel):
    """Alcance de la descarga. Sin cuerpo, la Biblia entera."""

    books: Optional[List[int]] = Field(
        default=None,
        description="Números de libro (1-66) a descargar. Por defecto, los 66.",
    )


def _last_event_id(raw: Optional[str]) -> int:
    try:
        return max(0, int(str(raw or "0").strip()))
    except ValueError:
        return 0


# El orden de declaración manda en FastAPI: `/status` y `/bible/start` van
# ANTES que `/{job_id}`, o la ruta comodín se los tragaría y `/status` acabaría
# respondiendo "esa descarga ya no existe".


@router.get("/status")
async def status():
    """
    Cuánto hay descargado de los 1.189 capítulos.

    Lo consulta la pantalla de ajustes al abrirse, así que es una sola consulta
    agregada a la caché: nada de red y nada de recorrer capítulo a capítulo.
    Si hay una descarga viva, se devuelve su id para que la interfaz se
    reenganche al volver a la pantalla en vez de ofrecer empezar otra vez.
    """
    activo = get_registry().live_job()
    return {**library_status(), "job_id": activo.job_id if activo else None}


@router.post("/bible/start")
async def start_bible(payload: Optional[BibleDownloadRequest] = None):
    """Arranca la descarga y devuelve su id inmediatamente."""
    libros = payload.books if payload else None
    objetivos = chapter_targets(libros)
    if not objetivos:
        raise HTTPException(400, "Ningún libro válido en el alcance pedido.")

    try:
        job = start_job(libros)
    except JobLimitReached as exc:
        # 409 y no 429: no es que vaya demasiado rápido, es que ya hay una en
        # marcha y lo que la interfaz debe hacer es engancharse a ella.
        activo = get_registry().live_job()
        raise HTTPException(
            409,
            str(exc),
            headers={"X-Offline-Job-Id": activo.job_id} if activo else None,
        )

    pendientes = sum(
        1 for book_number, chapter in objetivos if not is_cached(book_number, chapter)
    )
    return {
        "job_id": job.job_id,
        "total": len(objetivos),
        "pending": pendientes,
        "estimated_seconds": estimated_seconds(pendientes),
    }


@router.get("/stream/{job_id}")
async def stream(
    job_id: str,
    last_event_id: Optional[str] = Header(default=None, alias="Last-Event-ID"),
):
    """
    SSE del trabajo, reanudable.

    Con ``Last-Event-ID: 7`` se reemite desde el 8: cerrar la app y volver no
    cuesta ni un evento ni un capítulo repetido.
    """
    job = get_registry().get(job_id)
    if job is None:
        raise HTTPException(404, "Esa descarga ya no existe.")

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
        raise HTTPException(404, "Esa descarga ya no existe.")
    return job.snapshot()


@router.post("/{job_id}/cancel", status_code=204)
async def cancel(job_id: str) -> Response:
    """Cancela. Idempotente: cancelar dos veces no es un error del usuario."""
    if get_registry().get(job_id) is None:
        raise HTTPException(404, "Esa descarga ya no existe.")
    get_registry().cancel(job_id)
    return Response(status_code=204)


__all__ = ["router"]
