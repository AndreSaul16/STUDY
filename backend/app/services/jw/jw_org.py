"""
jw.org — búsqueda global, vídeos y transcripciones.

Por qué existe, si ya teníamos ``wol_library``: **son dos catálogos distintos.**
wol.jw.org es la Biblioteca en Línea (revistas, libros, guía de actividades) y
su buscador solo ve texto publicado. jw.org indexa además todo JW Broadcasting
—los vídeos, que en WOL sencillamente no están— y los artículos web que nunca
salieron en papel. Buscar solo en WOL deja fuera la mitad del material del que
el usuario prepara sus partes.

Las tres piezas, verificadas en vivo contra los endpoints públicos:

  1. **Búsqueda**  ``b.jw-cdn.org/apis/search/results/{lang}/{tipo}``
     Es la misma API que usa el buscador de la web. Exige un *bearer* que se
     descarga sin credenciales de ``b.jw-cdn.org/tokens/jworg.jwt``: es un token
     público y anónimo, el que el propio navegador pide al abrir jw.org.
     Devuelve grupos anidados (Publicaciones, Vídeos, Audio…) que aquí se
     aplanan. Admite ``sort=rel|newest|oldest``, que es la mitad del filtro por
     fecha.

  2. **Ficha del vídeo**  ``b.jw-cdn.org/apis/mediator/v1/media-items/{lang}/{lank}``
     Sin token. De aquí salen el título, la fecha real de publicación
     (``firstPublished``, la fecha más fiable que da todo jw.org) y la URL del
     archivo de subtítulos.

  3. **Transcripción**  el ``.vtt`` de subtítulos, convertido a texto corrido.
     Esto es lo que hace que un vídeo sea *investigable*: sin transcripción, un
     resultado de vídeo es un título y poco más, y el agente no puede citarlo.

El puente con lo que ya había: los resultados de jw.org traen un enlace a WOL
con ``docid=NNN``, y ese número **es** el ``doc_id`` que come
``wol_library.get_document``. Así el agente busca en el catálogo bueno y lee el
artículo con el lector en español que ya funcionaba.

Todo se cachea en ``content_cache`` (SQLite, sobrevive al reinicio). Los
documentos y las transcripciones son inmutables; las búsquedas caducan.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Optional
from urllib.parse import parse_qs, urlparse

import httpx

from . import content_cache, pub_dates

logger = logging.getLogger(__name__)

# ─── Configuración ───────────────────────────────────────────────

_TOKEN_URL = "https://b.jw-cdn.org/tokens/jworg.jwt"
_SEARCH_URL = "https://b.jw-cdn.org/apis/search/results"
_MEDIATOR_URL = "https://b.jw-cdn.org/apis/mediator/v1/media-items"

#: Símbolo de idioma de jw.org ("S" = español). No es el ISO 639: jw.org usa su
#: propio código de tres letras como mucho, y el español es "S".
_LANG = os.getenv("JW_ORG_LANG", "S").strip() or "S"

_TIMEOUT_SECONDS = 20.0
_USER_AGENT = "StudyApp/1.0 (+https://www.jw.org)"

#: El token vale bastante más, pero renovarlo es una petición de 1 KB.
_TOKEN_TTL_SECONDS = 3600

#: Tipos de búsqueda que expone jw.org. "all" mezcla todos y es lo que se usa
#: por defecto; "videos" es el que aporta lo que WOL no tiene.
SEARCH_KINDS = ("all", "publications", "videos", "audio", "bible")

#: Órdenes admitidos por la API, con el nombre que usa la app de por medio.
SORT_MODES = {
    "relevancia": "rel",
    "reciente": "newest",
    "antiguo": "oldest",
}

#: Tope de caracteres de una transcripción devuelta al modelo. Un vídeo de una
#: hora son ~50k caracteres: entero echa fuera de contexto al resto de fuentes.
_MAX_TRANSCRIPT_CHARS = 14_000


class JwOrgError(Exception):
    """Fallo al consultar jw.org. No expone trazas internas."""


# ─── Token público ───────────────────────────────────────────────

_token_lock = threading.Lock()
_token_value: str = ""
_token_fetched_at: float = 0.0


def _fetch_token() -> str:
    try:
        response = httpx.get(
            _TOKEN_URL,
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 — red, DNS, 4xx/5xx…
        logger.warning("No se pudo obtener el token de jw.org: %s", exc)
        raise JwOrgError("No se pudo consultar jw.org") from exc

    token = response.text.strip()
    if not token:
        raise JwOrgError("jw.org devolvió un token vacío")
    return token


def _token(force_refresh: bool = False) -> str:
    """Token público cacheado. ``force_refresh`` es lo que arregla un 401."""
    global _token_value, _token_fetched_at

    with _token_lock:
        fresco = (
            _token_value
            and not force_refresh
            and (time.time() - _token_fetched_at) < _TOKEN_TTL_SECONDS
        )
        if fresco:
            return _token_value

        _token_value = _fetch_token()
        _token_fetched_at = time.time()
        return _token_value


def reset_token_cache() -> None:
    """Solo para los tests."""
    global _token_value, _token_fetched_at
    with _token_lock:
        _token_value = ""
        _token_fetched_at = 0.0


# ─── Modelos ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class JwResult:
    """Un resultado de la búsqueda de jw.org, ya normalizado."""

    lank: str
    """Identificador de jw.org. Es lo que come ``get_video`` para los vídeos."""
    kind: str
    """"article" | "video" | "audio" | "index" | "bible" …"""
    title: str
    snippet: str
    context: str
    """Publicación o sección de la que sale, ej. "Perspicacia, volumen 1"."""
    url: str
    duration: str = ""
    year: Optional[int] = None
    doc_id: Optional[int] = None
    """``docId`` de wol.jw.org cuando el resultado también está en la Biblioteca."""
    wol_url: str = ""

    def to_dict(self) -> dict:
        """Claves en español: esto lo lee el modelo, no otro programa."""
        data = {
            "lank": self.lank,
            "tipo": self.kind,
            "titulo": self.title,
            "fragmento": self.snippet,
            "publicacion": self.context,
            "url": self.url,
            "anio": self.year,
        }
        if self.duration:
            data["duracion"] = self.duration
        if self.doc_id is not None:
            # El puente con la Biblioteca en Línea: con este doc_id se lee el
            # artículo entero en español con abrir_documento.
            data["doc_id"] = self.doc_id
        nota = pub_dates.freshness_note(self.year)
        if nota:
            data["aviso_fecha"] = nota
        return data


@dataclass(frozen=True)
class JwVideo:
    """Un vídeo de JW Broadcasting con su transcripción."""

    lank: str
    title: str
    description: str
    published: str
    """Fecha ISO de publicación. La fecha más fiable de todo jw.org."""
    duration: str
    url: str
    transcript: str = ""
    truncated: bool = False
    subtitles_url: str = ""

    @property
    def year(self) -> Optional[int]:
        return pub_dates.parse_year(self.published)

    def to_dict(self) -> dict:
        data = {
            "lank": self.lank,
            "titulo": self.title,
            "descripcion": self.description,
            "publicado": self.published,
            "anio": self.year,
            "duracion": self.duration,
            "fuente": self.url,
            "transcripcion": self.transcript,
            "truncado": self.truncated,
        }
        nota = pub_dates.freshness_note(self.year)
        if nota:
            data["aviso_fecha"] = nota
        return data


# ─── HTTP ────────────────────────────────────────────────────────


def _get(
    url: str,
    params: Optional[dict] = None,
    *,
    authenticated: bool = False,
    _retried: bool = False,
) -> httpx.Response:
    """
    GET a jw.org. Un 401 en un endpoint autenticado renueva el token y
    reintenta UNA vez: el token público caduca y no avisa.
    """
    headers = {"User-Agent": _USER_AGENT, "Accept-Language": "es"}
    if authenticated:
        headers["Authorization"] = f"Bearer {_token(force_refresh=_retried)}"

    try:
        response = httpx.get(
            url,
            params=params,
            timeout=_TIMEOUT_SECONDS,
            headers=headers,
            follow_redirects=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Petición a jw.org falló (%s): %s", url, exc)
        raise JwOrgError("No se pudo consultar jw.org") from exc

    if response.status_code == 401 and authenticated and not _retried:
        logger.info("Token de jw.org caducado; renovando.")
        return _get(url, params, authenticated=True, _retried=True)

    if response.status_code >= 400:
        logger.warning("jw.org respondió %s en %s", response.status_code, url)
        raise JwOrgError("No se pudo consultar jw.org")

    return response


# ─── Búsqueda ────────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")
_DOCID_RE = re.compile(r"[?&]docid=(\d+)", re.IGNORECASE)


def _clean(text: Any) -> str:
    """Quita el marcado de resaltado (``<strong>``) y normaliza los espacios."""
    if not isinstance(text, str):
        return ""
    return " ".join(_TAG_RE.sub(" ", text).split())


def _walk_items(node: Any) -> Iterable[dict]:
    """Aplana los grupos anidados de la respuesta de búsqueda."""
    if isinstance(node, dict):
        if node.get("type") == "item":
            yield node
        for child in node.get("results") or []:
            yield from _walk_items(child)
    elif isinstance(node, list):
        for child in node:
            yield from _walk_items(child)


def _doc_id_from_links(links: Any) -> tuple[Optional[int], str]:
    """
    ``doc_id`` de WOL y su URL a partir de los enlaces del resultado.

    El puente con ``wol_library``: el ``docid`` del enlace a WOL es exactamente
    el identificador que espera ``get_document``. Comprobado en vivo —
    ``/wol/finder?docid=1200001360`` redirige a ``/es/wol/d/r4/lp-s/1200001360``.
    """
    if not isinstance(links, dict):
        return None, ""

    wol_url = links.get("wol")
    if not isinstance(wol_url, str) or not wol_url:
        return None, ""

    match = _DOCID_RE.search(wol_url)
    if match is None:
        return None, wol_url
    try:
        return int(match.group(1)), wol_url
    except ValueError:
        return None, wol_url


def _deep_link_snippets(item: dict, limit: int = 3) -> str:
    """
    Fragmentos con marca de tiempo de un resultado de vídeo.

    Son literalmente trozos de la transcripción con el término buscado dentro.
    Para un vídeo valen más que el ``snippet`` genérico: dicen *dónde* dentro
    del vídeo está lo que se buscaba.
    """
    trozos: list[str] = []
    for deep in (item.get("deepLinks") or [])[:limit]:
        if not isinstance(deep, dict):
            continue
        texto = _clean(deep.get("snippet"))
        if not texto:
            continue
        marca = _clean(deep.get("jumpLabel"))
        trozos.append(f"[{marca}] {texto}" if marca else texto)
    return " · ".join(trozos)


def _parse_item(item: dict) -> Optional[JwResult]:
    lank = item.get("lank")
    if not isinstance(lank, str) or not lank:
        return None

    title = _clean(item.get("title"))
    if not title:
        return None

    links = item.get("links") or {}
    doc_id, wol_url = _doc_id_from_links(links)
    url = ""
    if isinstance(links, dict):
        url = links.get("jw.org") or ""
    if not isinstance(url, str):
        url = ""

    kind = str(item.get("subtype") or "article")
    context = _clean(item.get("context"))

    snippet = _clean(item.get("snippet"))
    if kind == "video":
        profundo = _deep_link_snippets(item)
        if profundo:
            snippet = profundo

    # SOLO la clave. La búsqueda de jw.org no publica la fecha de sus
    # resultados, y sacarla del título o del ``context`` daba fechas falsas: el
    # índice "…Watch Tower 1986-2026" salía como de 2026 y el vídeo "En 1914 el
    # mundo cambió de rumbo" como de 1914. La fecha exacta se obtiene al abrir
    # el vídeo (mediator) o el documento (símbolo de la publicación en WOL).
    year = pub_dates.parse_year(lank)

    return JwResult(
        lank=lank,
        kind=kind,
        title=title,
        snippet=snippet[:600],
        context=context,
        url=url,
        duration=_clean(item.get("duration")),
        year=year,
        doc_id=doc_id,
        wol_url=wol_url,
    )


def search(
    query: str,
    kind: str = "all",
    limit: int = 8,
    sort: str = "relevancia",
    since: Optional[int] = None,
    until: Optional[int] = None,
) -> list[JwResult]:
    """
    Busca en jw.org y devuelve los resultados normalizados.

    ``since``/``until`` se aplican **después** de recibir la respuesta: la API
    no tiene filtro por rango de años, solo ordenación. Por eso se pide un
    margen de más y se recorta aquí. Lo que no se puede fechar no se descarta
    (ver ``pub_dates``).
    """
    clean = " ".join((query or "").split())
    if not clean:
        return []

    tipo = kind if kind in SEARCH_KINDS else "all"
    orden = SORT_MODES.get(sort, "rel")
    tope = max(1, min(int(limit or 8), 20))

    # Con filtro de años se pide de más porque el recorte es posterior: pedir 8
    # y quedarse con 2 sería un resultado pobre por un detalle de implementación.
    pedidos = tope * 3 if (since or until) else tope
    pedidos = min(pedidos, 50)

    cache_key = f"{_LANG}|{tipo}|{orden}|{pedidos}|{clean}"
    cacheado = content_cache.get("jworg_search", cache_key)
    if cacheado is None:
        response = _get(
            f"{_SEARCH_URL}/{_LANG}/{tipo}",
            params={"q": clean, "limit": pedidos, "sort": orden},
            authenticated=True,
        )
        try:
            cacheado = response.json()
        except ValueError as exc:
            raise JwOrgError("jw.org devolvió una respuesta ilegible") from exc
        content_cache.put(
            "jworg_search",
            cache_key,
            cacheado,
            ttl_seconds=content_cache.search_ttl(),
        )

    resultados: list[JwResult] = []
    vistos: set[str] = set()
    for raw in _walk_items(cacheado):
        parsed = _parse_item(raw)
        if parsed is None or parsed.lank in vistos:
            continue
        if not pub_dates.within_range(parsed.year, since, until):
            continue
        vistos.add(parsed.lank)
        resultados.append(parsed)
        if len(resultados) >= tope:
            break

    return resultados


# ─── Vídeo y transcripción ───────────────────────────────────────

_CUE_RE = re.compile(r"^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->")
_VTT_TAG_RE = re.compile(r"</?[cvibu][^>]*>", re.IGNORECASE)


def parse_vtt(raw: str) -> str:
    """
    Convierte un ``.vtt`` de subtítulos en texto corrido.

    Tres cosas que hay que quitar sí o sí, porque el formato real las trae:
    las marcas de tiempo, las etiquetas de estilo (``<v Locutor>``, ``<c.rojo>``)
    y las líneas repetidas seguidas — los subtítulos de rodillo repiten la
    última frase en el bloque siguiente y sin deduplicar el texto sale doblado.
    """
    lineas: list[str] = []
    anterior = ""

    for linea in (raw or "").splitlines():
        texto = linea.strip()
        if not texto:
            continue
        if texto.upper().startswith("WEBVTT") or texto.startswith("NOTE"):
            continue
        if _CUE_RE.match(texto):
            continue
        # Identificador de cue: una línea que es solo un número.
        if texto.isdigit():
            continue

        texto = " ".join(_VTT_TAG_RE.sub("", texto).split())
        if not texto or texto == anterior:
            continue

        lineas.append(texto)
        anterior = texto

    return " ".join(lineas)


def _subtitles_url(media: dict) -> str:
    """Primera URL de subtítulos que aparezca entre los archivos del vídeo."""
    for archivo in media.get("files") or []:
        if not isinstance(archivo, dict):
            continue
        subs = archivo.get("subtitles")
        if isinstance(subs, dict) and isinstance(subs.get("url"), str):
            return subs["url"]
    return ""


def _fetch_transcript(url: str) -> str:
    """Descarga y limpia los subtítulos. Un fallo aquí NO tumba la ficha."""
    if not url:
        return ""
    try:
        response = httpx.get(
            url,
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudieron descargar los subtítulos (%s): %s", url, exc)
        return ""
    return parse_vtt(response.text)


def get_video(lank: str, with_transcript: bool = True) -> JwVideo:
    """
    Ficha de un vídeo por su ``lank``, con la transcripción de sus subtítulos.

    ``lank`` es lo que devuelve ``search`` para los resultados de tipo vídeo.
    Vale tanto la forma ``pub-jwbcov_201705_15_VIDEO`` como
    ``docid-1112024059_1_VIDEO``: el mediator acepta las dos.
    """
    clean = (lank or "").strip()
    if not clean:
        raise JwOrgError("Falta el identificador del vídeo")

    cache_key = f"{_LANG}|{clean}"
    cacheado = content_cache.get("jworg_video", cache_key)
    if cacheado is None:
        response = _get(f"{_MEDIATOR_URL}/{_LANG}/{clean}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise JwOrgError("jw.org devolvió una respuesta ilegible") from exc

        medios = payload.get("media") or []
        if not medios or not isinstance(medios[0], dict):
            raise JwOrgError("Ese vídeo no existe en jw.org")

        media = medios[0]
        subtitles = _subtitles_url(media)
        cacheado = {
            "lank": clean,
            "title": _clean(media.get("title")) or clean,
            "description": _clean(media.get("description")),
            "published": str(media.get("firstPublished") or ""),
            "duration": str(media.get("durationFormattedMinSec") or ""),
            "subtitles_url": subtitles,
            "transcript": _fetch_transcript(subtitles) if with_transcript else "",
        }
        # Permanente: un vídeo publicado y sus subtítulos no cambian.
        content_cache.put("jworg_video", cache_key, cacheado)

    texto = cacheado.get("transcript") or ""
    truncado = len(texto) > _MAX_TRANSCRIPT_CHARS

    return JwVideo(
        lank=cacheado["lank"],
        title=cacheado["title"],
        description=cacheado["description"],
        published=cacheado["published"],
        duration=cacheado["duration"],
        url=f"https://www.jw.org/finder?lank={cacheado['lank']}&wtlocale={_LANG}",
        transcript=texto[:_MAX_TRANSCRIPT_CHARS],
        truncated=truncado,
        subtitles_url=cacheado.get("subtitles_url", ""),
    )


__all__ = [
    "JwOrgError",
    "JwResult",
    "JwVideo",
    "SEARCH_KINDS",
    "SORT_MODES",
    "get_video",
    "parse_vtt",
    "reset_token_cache",
    "search",
]
