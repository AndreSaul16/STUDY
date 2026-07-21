"""
JW Router — consultas de solo lectura a wol.jw.org (sin IA).

GET /api/jw/daily-text  — texto del día (Examinemos las Escrituras).
    Query param opcional `date=YYYY-MM-DD` (por defecto, hoy).
"""

import datetime
import logging

from fastapi import APIRouter, HTTPException, Query

from ..services.jw import DailyTextError, fetch_daily_text

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
        daily = fetch_daily_text(target)
    except DailyTextError:
        logger.exception("Fallo al obtener el texto del día")
        raise HTTPException(502, "No se pudo obtener el texto del día")

    return daily.to_dict()
