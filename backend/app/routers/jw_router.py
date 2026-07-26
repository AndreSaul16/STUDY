"""
JW Router — consultas de solo lectura a wol.jw.org (sin IA).

GET /api/jw/daily-text          — texto del día (Examinemos las Escrituras).
    Query param opcional `date=YYYY-MM-DD` (por defecto, hoy).
GET /api/jw/bible/books         — catálogo de los 66 libros con sus capítulos.
GET /api/jw/bible/{book}/{chap} — capítulo completo, versículo a versículo.
"""

import datetime
import logging

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..services.jw import DailyTextError, fetch_daily_text
from ..services.jw.book_numbers import all_books
from ..services.references import ReferenceResolutionError, fetch_chapter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jw", tags=["jw"])


@router.get("/daily-text")
async def get_daily_text(
    date: str | None = Query(
        default=None,
        description="Fecha en formato YYYY-MM-DD. Por defecto, hoy.",
    ),
):
    """Devuelve el texto del día desde wol.jw.org (consulta normal, sin IA)."""
    target: datetime.date | None = None
    if date:
        try:
            target = datetime.date.fromisoformat(date)
        except ValueError:
            raise HTTPException(400, "Fecha inválida. Usa el formato YYYY-MM-DD.")

    try:
        daily = await run_in_threadpool(fetch_daily_text, target)
    except DailyTextError:
        logger.exception("Fallo al obtener el texto del día")
        raise HTTPException(502, "No se pudo obtener el texto del día")

    return daily.to_dict()


@router.get("/bible/books")
async def list_bible_books():
    """
    Catálogo de los 66 libros con su número de capítulos.

    Es una constante del canon, no una consulta a WOL: el navegador de la
    Biblia puede pintar la rejilla de capítulos sin esperar a la red.
    """
    return {"books": all_books()}


@router.get("/bible/{book}/{chapter}")
async def get_bible_chapter(book: str, chapter: int):
    """Devuelve un capítulo completo de la Biblia en español (WOL)."""
    try:
        result = await run_in_threadpool(fetch_chapter, book, chapter)
    except ReferenceResolutionError as exc:
        raise HTTPException(404, str(exc))
    except Exception:  # noqa: BLE001 — no exponer trazas internas
        logger.exception("Fallo al obtener %s %s", book, chapter)
        raise HTTPException(502, "No se pudo obtener el capítulo")

    return result.to_dict()
