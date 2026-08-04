"""
References Router — resuelve referencias a su contenido real (español, WOL).

GET /api/references/resolve?identifier=scripture:efesios:4:15
    Texto de un versículo o capítulo. {identifier, title, content, source_url, source}.
GET /api/references/search?q=amor+al+prójimo
    Busca en la Biblioteca en Línea. Devuelve {results: [{doc_id, citation, ...}]}.
GET /api/references/document/{doc_id}
    Artículo completo de wol.jw.org, ya troceado en bloques.
GET /api/references/versions
    Catálogo de traducciones disponibles para comparar.
GET /api/references/versions/{version}/{book}/{chapter}
    Un capítulo en otra traducción.
GET /api/references/compare?libro=43&capitulo=3&verso=16
    El mismo versículo en varias traducciones, en paralelo.

El contenido principal viene de wol.jw.org en ESPAÑOL (el MCP queda como
fallback en inglés sólo para versículos). Las otras traducciones vienen de
``services/external/bible_versions``, y son SOLO de dominio público: ver ahí
por qué no están la Reina-Valera 1960 ni la NVI.
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..services.external.bible_versions import (
    BibleVersionError,
    catalog as version_catalog,
    compare as compare_versions,
    fetch_chapter as fetch_version_chapter,
)
from ..services.jw.wol_library import WolError, get_document, search_library
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


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2, description="Términos de búsqueda en español"),
    limit: int = Query(8, ge=1, le=20),
):
    """Busca publicaciones en la Biblioteca en Línea (wol.jw.org, español)."""
    try:
        results = await run_in_threadpool(search_library, q, limit)
    except WolError:
        raise HTTPException(502, "No se pudo consultar la biblioteca")
    except Exception:  # noqa: BLE001 — no exponer trazas internas
        logger.exception("Error inesperado buscando %r", q)
        raise HTTPException(502, "No se pudo consultar la biblioteca")

    return {"query": q, "results": [r.to_dict() for r in results]}


@router.get("/versions")
async def versions():
    """
    Traducciones disponibles para comparar.

    La Traducción del Nuevo Mundo va la primera y marcada como principal: es la
    de referencia, y las demás están para contrastar, no para sustituirla.
    """
    return {"versiones": version_catalog()}


@router.get("/versions/{version}/{book}/{chapter}")
async def version_chapter(version: str, book: int, chapter: int):
    """Un capítulo completo en otra traducción."""
    try:
        capitulo = await run_in_threadpool(fetch_version_chapter, version, book, chapter)
    except BibleVersionError as exc:
        raise HTTPException(404, str(exc))
    except Exception:  # noqa: BLE001 — no exponer trazas internas
        logger.exception("Error inesperado con %s %s:%s", version, book, chapter)
        raise HTTPException(502, "No se pudo obtener esa traducción")

    return capitulo.to_dict()


@router.get("/compare")
async def compare(
    libro: int = Query(..., ge=1, le=66, description="Número de libro (1-66)"),
    capitulo: int = Query(..., ge=1),
    verso: int = Query(..., ge=1),
    versiones: str = Query(
        "",
        description="Ids separados por comas. Vacío = todas las disponibles.",
    ),
):
    """
    El mismo versículo en varias traducciones.

    NO incluye la Traducción del Nuevo Mundo: el cliente ya la tiene del lector
    y añadirla aquí supondría una segunda petición a WOL por cada comparación.
    """
    pedidas = [v.strip() for v in versiones.split(",") if v.strip()] or None

    try:
        return await run_in_threadpool(compare_versions, libro, capitulo, verso, pedidas)
    except Exception:  # noqa: BLE001
        logger.exception("Error inesperado comparando %s %s:%s", libro, capitulo, verso)
        raise HTTPException(502, "No se pudo comparar las traducciones")


@router.get("/document/{doc_id}")
async def document(doc_id: int):
    """Devuelve un artículo completo de la Biblioteca en Línea."""
    try:
        doc = await run_in_threadpool(get_document, doc_id)
    except WolError:
        raise HTTPException(404, "Documento no encontrado")
    except Exception:  # noqa: BLE001
        logger.exception("Error inesperado abriendo el documento %s", doc_id)
        raise HTTPException(502, "No se pudo abrir el documento")

    return doc.to_dict()
