"""
Daily Text — "Texto del día" (Examinemos las Escrituras) desde wol.jw.org.

Consulta de SOLO LECTURA (sin IA/LLM): descarga el HTML del texto diario en
español y extrae el versículo tema y el comentario mediante BeautifulSoup.

Fuente:
    https://wol.jw.org/es/wol/dt/r4/lp-s/{año}/{mes}/{día}

`r4`/`lp-s` = biblioteca en español. En la página del día conviven varios
bloques `todayItem` (texto diario, guía de reuniones, índice de La Atalaya…).
El texto diario es el que lleva `pub-es` en su class (docClass-4); los demás
(`pub-mwb`, `pub-w`, …) se ignoran.
"""

from __future__ import annotations

import datetime
import logging
from collections import OrderedDict
from dataclasses import asdict, dataclass

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ─── Configuración ───────────────────────────────────────────────
_BASE_URL = "https://wol.jw.org/es/wol/dt/r4/lp-s"
_TIMEOUT_SECONDS = 15.0
_USER_AGENT = "StudyApp/0.3 (+https://wol.jw.org)"

# Caché en memoria: el texto del día no cambia durante el día.
_CACHE_MAX_ENTRIES = 7
_cache: "OrderedDict[str, DailyText]" = OrderedDict()


class DailyTextError(Exception):
    """Error al obtener o parsear el texto del día. No expone trazas internas."""


@dataclass(frozen=True)
class DailyText:
    """Texto del día ya normalizado."""

    date_iso: str
    """Fecha en formato ISO (YYYY-MM-DD)."""
    date_label: str
    """Etiqueta legible tal como aparece en la web (ej. "Martes 21 de julio")."""
    theme_text: str
    """Versículo tema, sin la cita entre paréntesis."""
    theme_scripture_ref: str
    """Cita del versículo tema (ej. "Efes. 4:8")."""
    body: str
    """Comentario completo (uno o más párrafos concatenados)."""
    source_url: str
    """URL de wol.jw.org de la que proviene el texto."""

    def to_dict(self) -> dict:
        return asdict(self)


def _build_url(date: datetime.date) -> str:
    return f"{_BASE_URL}/{date.year}/{date.month}/{date.day}"


def _cache_put(date_iso: str, value: "DailyText") -> None:
    _cache[date_iso] = value
    _cache.move_to_end(date_iso)
    while len(_cache) > _CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


def _extract_ref_from_theme(theme_p) -> str:
    """
    El versículo tema lleva la cita en un <a class="b"> interno
    (ej. "Efes. 4:8"). Devuelve su texto o "" si no hay enlace.
    """
    link = theme_p.find("a")
    if link is not None:
        return link.get_text(strip=True)
    return ""


def parse_daily_text(html: str, source_url: str) -> DailyText:
    """
    Parsea el HTML del texto diario y devuelve un DailyText.

    Selecciona el bloque `todayItem` cuya class contenga `pub-es` (docClass-4),
    extrae la fecha (header <h2>), el versículo tema (`p.themeScrp`) y el
    comentario (`div.bodyTxt` → uno o más `p.sb`).

    Lanza DailyTextError si la estructura esperada no está presente.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")

        # Buscar el todayItem del texto diario: class con 'pub-es'.
        # Otros bloques (pub-mwb, pub-w) NO son el texto del día.
        daily_item = None
        for item in soup.select("div.todayItem"):
            classes = item.get("class", [])
            if "pub-es" in classes:
                daily_item = item
                break

        if daily_item is None:
            raise DailyTextError("No se encontró el bloque del texto del día")

        data = daily_item.select_one("div.itemData")
        if data is None:
            raise DailyTextError("Bloque del texto del día sin contenido")

        # Fecha legible: primer <h2> del header (ej. "Martes 21 de julio").
        header = data.find("header")
        date_label = ""
        if header is not None:
            h2 = header.find("h2")
            if h2 is not None:
                date_label = h2.get_text(strip=True)

        # Versículo tema.
        theme_p = data.select_one("p.themeScrp")
        if theme_p is None:
            raise DailyTextError("No se encontró el versículo tema")
        theme_ref = _extract_ref_from_theme(theme_p)
        theme_full = theme_p.get_text(" ", strip=True)

        # Cuerpo del comentario: uno o más p.sb dentro de bodyTxt.
        body_container = data.select_one("div.bodyTxt")
        body_paragraphs: list[str] = []
        if body_container is not None:
            for p in body_container.select("p.sb"):
                text = p.get_text(" ", strip=True)
                if text:
                    body_paragraphs.append(text)
        body = "\n\n".join(body_paragraphs)

        if not theme_full or not body:
            raise DailyTextError("El texto del día está incompleto")

        return DailyText(
            date_iso=_date_iso_from_url(source_url),
            date_label=date_label,
            theme_text=theme_full,
            theme_scripture_ref=theme_ref,
            body=body,
            source_url=source_url,
        )
    except DailyTextError:
        raise
    except Exception as exc:  # noqa: BLE001 — normalizamos cualquier fallo de parseo
        logger.exception("Fallo al parsear el texto del día")
        raise DailyTextError("No se pudo interpretar el texto del día") from exc


def _date_iso_from_url(source_url: str) -> str:
    """
    Deriva la fecha ISO de la URL .../{año}/{mes}/{día}.
    Si no se puede, devuelve "" (el date_label sigue siendo legible).
    """
    try:
        parts = [p for p in source_url.split("?")[0].split("/") if p]
        year, month, day = int(parts[-3]), int(parts[-2]), int(parts[-1])
        return datetime.date(year, month, day).isoformat()
    except Exception:  # noqa: BLE001
        return ""


def fetch_daily_text(date: datetime.date | None = None) -> DailyText:
    """
    Obtiene el texto del día para la fecha dada (hoy por defecto).

    Usa caché en memoria por fecha. Lanza DailyTextError ante cualquier fallo
    de red o de parseo (sin exponer trazas internas).
    """
    target = date or datetime.date.today()
    date_iso = target.isoformat()

    cached = _cache.get(date_iso)
    if cached is not None:
        _cache.move_to_end(date_iso)
        return cached

    url = _build_url(target)
    try:
        response = httpx.get(
            url,
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
        )
        response.raise_for_status()
        html = response.text
    except httpx.HTTPError as exc:
        logger.exception("Fallo al descargar el texto del día desde %s", url)
        raise DailyTextError("No se pudo obtener el texto del día") from exc

    result = parse_daily_text(html, url)
    _cache_put(date_iso, result)
    return result
