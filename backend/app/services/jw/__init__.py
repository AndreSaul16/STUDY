"""JW online services — consultas de solo lectura a wol.jw.org (sin IA)."""

from .daily_text import (
    DailyText,
    DailyTextError,
    fetch_daily_text,
    parse_daily_text,
)

__all__ = [
    "DailyText",
    "DailyTextError",
    "fetch_daily_text",
    "parse_daily_text",
]
