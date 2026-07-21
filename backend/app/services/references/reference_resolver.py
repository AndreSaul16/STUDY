"""
Reference Resolver — resuelve identificadores de escritura a su texto REAL.

El frontend detecta citas bíblicas y las normaliza a identificadores del tipo:

    scripture:{libro-español}:{capítulo}:{versículo|all}

p. ej. ``scripture:efesios:4:15`` o ``scripture:salmo:23:all``.

Fuente principal (ESPAÑOL): wol.jw.org, edición en español de la Traducción del
Nuevo Mundo (nwtsty):

    https://wol.jw.org/es/wol/b/r4/lp-s/nwtsty/{bookNum}/{chapter}

El texto de cada versículo está en ``span.v`` con id ``v{book}-{chap}-{verse}-{seq}``
(ej. ``v49-4-15-1``). Dentro del span, el primer ``<a>`` es el número de versículo
y los ``<a class="b">`` son marcadores de referencia cruzada ("+"); ambos se
eliminan para quedarnos con el texto limpio.

FALLBACK (INGLÉS): si el parseo en español falla, se usa el MCP
``get_verse_with_study(book, chapter, verse)`` y se marca ``source="mcp"``.
"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from dataclasses import asdict, dataclass

import httpx
from bs4 import BeautifulSoup

from ..jw.book_numbers import book_display_name, book_number

logger = logging.getLogger(__name__)

# ─── Configuración ───────────────────────────────────────────────
_WOL_BASE = "https://wol.jw.org/es/wol/b/r4/lp-s/nwtsty"
_TIMEOUT_SECONDS = 15.0
_USER_AGENT = "StudyApp/0.3 (+https://wol.jw.org)"

# Caché en memoria por identifier (el texto bíblico no cambia).
_CACHE_MAX_ENTRIES = 256
_cache: "OrderedDict[str, ResolvedReference]" = OrderedDict()


class ReferenceResolutionError(Exception):
    """No se pudo resolver la referencia. No expone trazas internas."""


@dataclass(frozen=True)
class ResolvedReference:
    """Referencia resuelta a contenido real."""

    identifier: str
    title: str
    """Ej. "Efesios 4:15" o "Efesios 4"."""
    content: str
    """Texto del/los versículo(s), en español (o inglés si vino del fallback)."""
    source_url: str
    source: str
    """"wol" (español) o "mcp" (fallback inglés)."""

    def to_dict(self) -> dict:
        return asdict(self)


def _parse_identifier(identifier: str) -> tuple[str, int, str]:
    """
    Descompone ``scripture:{libro}:{cap}:{v|all}``.

    Devuelve (nombre_libro, capítulo, versículo). ``versículo`` puede ser "all".
    Lanza ReferenceResolutionError si el formato no es válido.
    """
    parts = identifier.split(":")
    if len(parts) != 4 or parts[0] != "scripture":
        raise ReferenceResolutionError("Identificador de referencia no soportado")
    _, book_name, chapter_raw, verse_raw = parts
    try:
        chapter = int(chapter_raw)
    except ValueError as exc:
        raise ReferenceResolutionError("Capítulo inválido") from exc
    verse = verse_raw.strip().lower() or "all"
    return book_name, chapter, verse


def _clean_verse_span(span) -> str:
    """Extrae el texto de un ``span.v`` quitando nº de versículo y refs cruzadas."""
    fragment = BeautifulSoup(str(span), "html.parser")
    node = fragment.select_one("span.v") or fragment
    # Quitar marcadores de referencia cruzada ("+", a.b) y de nota al pie ("*", a.fn).
    for a in node.select("a.b, a.fn"):
        a.decompose()
    # Quitar el número de versículo (primer <a> cuyo texto son solo dígitos).
    first_a = node.find("a")
    if first_a is not None and re.match(r"^\s*\d+\s*$", first_a.get_text()):
        first_a.decompose()
    return node.get_text(" ", strip=True)


def _parse_wol_spanish(
    html: str, book_num: int, chapter: int, verse: str
) -> str:
    """
    Extrae de la página WOL el texto del versículo (o todos si verse=="all").

    Devuelve el texto o "" si no se encontró ningún versículo (para disparar
    el fallback).
    """
    soup = BeautifulSoup(html, "html.parser")
    spans = soup.select("span.v")

    if verse == "all":
        # Agrupar por número de versículo, prefijando cada uno con su número.
        prefix = re.compile(rf"^v{book_num}-{chapter}-(\d+)-")
        by_verse: "OrderedDict[int, list[str]]" = OrderedDict()
        for span in spans:
            m = prefix.match(span.get("id", ""))
            if not m:
                continue
            vnum = int(m.group(1))
            # El versículo 0 es el encabezamiento del salmo (superscripción); omitir.
            if vnum == 0:
                continue
            by_verse.setdefault(vnum, []).append(_clean_verse_span(span))
        chunks = [
            f"{vnum} {' '.join(t for t in texts if t)}".strip()
            for vnum, texts in sorted(by_verse.items())
        ]
        return "  ".join(c for c in chunks if c)

    # Versículo concreto: id exacto ``v{book}-{chap}-{verse}-*``.
    prefix = re.compile(rf"^v{book_num}-{chapter}-{verse}-")
    parts = [
        _clean_verse_span(span)
        for span in spans
        if prefix.match(span.get("id", ""))
    ]
    return " ".join(p for p in parts if p).strip()


def _fallback_mcp(
    book_num: int, chapter: int, verse: str, identifier: str
) -> ResolvedReference:
    """Fallback: obtiene el versículo (en INGLÉS) via MCP get_verse_with_study."""
    # Import perezoso para no acoplar el arranque al bridge del MCP.
    from ..ai.mcp_bridge import get_mcp_bridge

    mcp_verse = "1" if verse == "all" else verse
    try:
        bridge = get_mcp_bridge()
        result = bridge.call_tool(
            "get_verse_with_study",
            {
                "book": book_num,
                "chapter": chapter,
                "verse": mcp_verse,
                "fields": ["verses"],
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallback MCP falló para %s", identifier)
        raise ReferenceResolutionError("No se pudo resolver la referencia") from exc

    content = _extract_mcp_text(result)
    if not content:
        raise ReferenceResolutionError("No se pudo resolver la referencia")

    display = book_display_name(book_num)
    title = f"{display} {chapter}" if verse == "all" else f"{display} {chapter}:{verse}"
    return ResolvedReference(
        identifier=identifier,
        title=title,
        content=content,
        source_url=f"{_WOL_BASE}/{book_num}/{chapter}",
        source="mcp",
    )


def _extract_mcp_text(result) -> str:
    """Intenta extraer texto legible de la respuesta (variable) del MCP."""
    # El bridge suele devolver {"content": [{"type":"text","text": "..."}]}.
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list):
            texts = [
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            joined = "\n".join(t for t in texts if t)
            if joined.strip():
                return joined.strip()
        # A veces devuelve el texto directamente en otras claves.
        for key in ("text", "verses", "combined_text"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(result, str) and result.strip():
        return result.strip()
    return ""


def resolve_reference(identifier: str) -> ResolvedReference:
    """
    Resuelve un identificador de escritura a su texto real (español vía WOL,
    con fallback al MCP en inglés). Cachea por identifier.

    Lanza ReferenceResolutionError ante cualquier fallo irrecuperable.
    """
    cached = _cache.get(identifier)
    if cached is not None:
        _cache.move_to_end(identifier)
        return cached

    book_name, chapter, verse = _parse_identifier(identifier)
    book_num = book_number(book_name)
    if book_num is None:
        raise ReferenceResolutionError(f"Libro no reconocido: {book_name}")

    url = f"{_WOL_BASE}/{book_num}/{chapter}"

    # 1) Intento principal: WOL en español.
    try:
        response = httpx.get(
            url,
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
        )
        response.raise_for_status()
        content = _parse_wol_spanish(response.text, book_num, chapter, verse)
    except Exception:  # noqa: BLE001 — cualquier fallo de red/parseo → fallback
        logger.exception("Parseo WOL español falló para %s", identifier)
        content = ""

    if content:
        display = book_display_name(book_num)
        title = (
            f"{display} {chapter}"
            if verse == "all"
            else f"{display} {chapter}:{verse}"
        )
        resolved = ResolvedReference(
            identifier=identifier,
            title=title,
            content=content,
            source_url=url,
            source="wol",
        )
    else:
        # 2) Fallback: MCP (inglés).
        resolved = _fallback_mcp(book_num, chapter, verse, identifier)

    _cache_put(identifier, resolved)
    return resolved


def _cache_put(identifier: str, value: ResolvedReference) -> None:
    _cache[identifier] = value
    _cache.move_to_end(identifier)
    while len(_cache) > _CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)
