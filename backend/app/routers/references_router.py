"""
References Router — resuelve identificadores de escritura a su texto real.

GET /api/references/resolve?identifier=scripture:efesios:4:15
    Devuelve {identifier, title, content, source_url, source}.
    El texto se obtiene de wol.jw.org en ESPAÑOL (fallback MCP en inglés).
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..services.references import ReferenceResolutionError, resolve_reference

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/references", tags=["references"])


@router.get("/resolve")
async def resolve(
    identifier: str = Query(
        ...,
        description="Identificador de escritura, ej. scripture:efesios:4:15",
    ),
):
    """Resuelve una referencia bíblica a su texto (español vía WOL)."""
    try:
        resolved = await run_in_threadpool(resolve_reference, identifier)
    except ReferenceResolutionError:
        logger.exception("No se pudo resolver la referencia %s", identifier)
        raise HTTPException(404, "No se pudo resolver la referencia")
    except Exception:  # noqa: BLE001 — no exponer trazas internas
        logger.exception("Error inesperado resolviendo %s", identifier)
        raise HTTPException(502, "Error al resolver la referencia")

    return resolved.to_dict()
