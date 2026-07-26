"""
WOL Library — búsqueda y lectura de publicaciones de wol.jw.org en ESPAÑOL.

Complementa a ``references.reference_resolver`` (que resuelve versículos) con
las dos operaciones que faltaban para que la app tenga contenido real:

    search_library(query)  → resultados de la búsqueda de la Biblioteca en Línea
    get_document(doc_id)   → artículo completo, ya troceado en bloques

Ambas leen la edición ESPAÑOLA (``/es/wol/.../lp-s``), a diferencia del MCP
``jw-mcp``, que sólo devuelve inglés. Eso hace que el chat y el panel de
referencias funcionen en español aunque el MCP no esté disponible.

Estructura del HTML de WOL (verificada en vivo, no supuesta):

  Búsqueda  ``/es/wol/s/r4/lp-s?q=...``
    li.result
      li.searchResult  → clases ``docId-{n}`` y ``pub-{symbol}``; el texto es
                         el fragmento con los términos resaltados en ``span.mk``
      li.ref           → cita legible, ej. "w06 1/12 págs. 25-29 - La Atalaya 2006"

  Documento ``/es/wol/d/r4/lp-s/{docId}``
    article#article  →  párrafos con clase semántica:
        p.st  título del artículo      p.ss  subtítulo de sección
        p.sa  texto temático           p.qu  pregunta de estudio
        p.sb  párrafo de cuerpo        (resto → párrafo)

No hay API pública de jw.org; esto es scraping del HTML publicado, igual que
el resolutor de versículos que ya existía. Se cachea en memoria para no
repetir peticiones (el contenido es estático).
"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from dataclasses import asdict, dataclass, field

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ─── Configuración ───────────────────────────────────────────────
_WOL_ORIGIN = "https://wol.jw.org"
_SEARCH_URL = f"{_WOL_ORIGIN}/es/wol/s/r4/lp-s"
_DOC_URL = f"{_WOL_ORIGIN}/es/wol/d/r4/lp-s"
_TIMEOUT_SECONDS = 20.0
_USER_AGENT = "StudyApp/1.0 (+https://wol.jw.org)"

_SEARCH_CACHE_MAX = 128
_DOC_CACHE_MAX = 64
_search_cache: "OrderedDict[str, list[SearchResult]]" = OrderedDict()
_doc_cache: "OrderedDict[int, WolDocument]" = OrderedDict()

# clase del <p> en WOL → tipo de bloque de nuestro dominio
_BLOCK_TYPE_BY_CLASS = {
    "st": "title",
    "ss": "heading",
    "sa": "scripture",
    "qu": "question",
    "sb": "paragraph",
    "sz": "caption",
}

_DOC_ID_RE = re.compile(r"docId-(\d+)")
_PUB_RE = re.compile(r"pub-([a-z0-9]+)", re.IGNORECASE)


class WolError(Exception):
    """Fallo al consultar wol.jw.org. No expone trazas internas."""


@dataclass(frozen=True)
class SearchResult:
    """Un resultado de la búsqueda de la Biblioteca en Línea."""

    doc_id: int
    citation: str
    """Cita legible, ej. "w06 1/12 págs. 25-29 - La Atalaya 2006"."""
    snippet: str
    """Fragmento con el contexto del término buscado."""
    publication: str
    """Símbolo de la publicación, ej. "w06"."""
    url: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class WolBlock:
    """Un bloque de contenido dentro de un documento."""

    block_id: int
    block_type: str
    content: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class WolDocument:
    """Un artículo completo de la Biblioteca en Línea."""

    doc_id: int
    title: str
    citation: str
    url: str
    blocks: list[WolBlock] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "citation": self.citation,
            "url": self.url,
            "blocks": [b.to_dict() for b in self.blocks],
        }

    @property
    def plain_text(self) -> str:
        """El documento como texto plano — lo que se le pasa al LLM."""
        return "\n\n".join(b.content for b in self.blocks if b.content)


def _get(url: str, params: dict | None = None) -> str:
    """GET a WOL con cabeceras educadas. Lanza WolError ante cualquier fallo."""
    try:
        response = httpx.get(
            url,
            params=params,
            timeout=_TIMEOUT_SECONDS,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept-Language": "es",
            },
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.text
    except Exception as exc:  # noqa: BLE001 — red, DNS, 4xx/5xx…
        logger.warning("Petición a WOL falló (%s): %s", url, exc)
        raise WolError("No se pudo consultar wol.jw.org") from exc


def _cache_put(cache: OrderedDict, key, value, max_entries: int) -> None:
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > max_entries:
        cache.popitem(last=False)


def _first_match(classes: list[str], pattern: re.Pattern) -> str | None:
    for cls in classes:
        m = pattern.fullmatch(cls) or pattern.match(cls)
        if m:
            return m.group(1)
    return None


# ─── Búsqueda ────────────────────────────────────────────────────


def search_library(query: str, limit: int = 8) -> list[SearchResult]:
    """
    Busca ``query`` en la Biblioteca en Línea (español) y devuelve los
    resultados más relevantes.

    Los resultados vienen ordenados por relevancia por el propio WOL; sólo
    recortamos a ``limit``.
    """
    clean = " ".join(query.split())
    if not clean:
        return []

    cache_key = f"{clean}|{limit}"
    cached = _search_cache.get(cache_key)
    if cached is not None:
        _search_cache.move_to_end(cache_key)
        return cached

    html = _get(_SEARCH_URL, params={"q": clean, "p": "par", "r": "occ"})
    soup = BeautifulSoup(html, "html.parser")

    results: list[SearchResult] = []
    seen: set[int] = set()

    for item in soup.select("li.result"):
        hit = item.select_one("li.searchResult")
        if hit is None:
            continue

        classes = hit.get("class") or []
        raw_id = _first_match(classes, _DOC_ID_RE)
        if raw_id is None:
            continue
        doc_id = int(raw_id)
        if doc_id in seen:
            continue
        seen.add(doc_id)

        # El símbolo útil es el segundo `pub-*` (el primero suele venir vacío).
        pubs = [p for p in (_first_match([c], _PUB_RE) for c in classes) if p]
        publication = pubs[-1] if pubs else ""

        ref = item.select_one("li.ref")
        citation = ref.get_text(" ", strip=True) if ref else ""

        snippet = " ".join(hit.get_text(" ", strip=True).split())

        results.append(
            SearchResult(
                doc_id=doc_id,
                citation=citation,
                snippet=snippet[:600],
                publication=publication,
                url=f"{_DOC_URL}/{doc_id}",
            )
        )

        if len(results) >= limit:
            break

    _cache_put(_search_cache, cache_key, results, _SEARCH_CACHE_MAX)
    return results


# ─── Documento ───────────────────────────────────────────────────


def _extract_blocks(article) -> list[WolBlock]:
    """Convierte los <p> del artículo en bloques tipados, sin duplicar texto."""
    blocks: list[WolBlock] = []
    next_id = 1

    for para in article.select("p"):
        # WOL anida <p> dentro de <p> en algunas secciones; quedarnos sólo con
        # los más internos evita emitir el mismo texto dos veces.
        if para.find("p") is not None:
            continue

        fragment = BeautifulSoup(str(para), "html.parser")
        node = fragment.find("p") or fragment

        # Quitar marcadores volados de nota al pie y de referencia cruzada:
        # sin destino navegable aquí, sólo ensucian la lectura.
        for marker in node.select("a.fn, .parNum sup, sup.fn"):
            marker.decompose()

        text = " ".join(node.get_text(" ", strip=True).split())
        if not text:
            continue

        classes = para.get("class") or []
        block_type = next(
            (_BLOCK_TYPE_BY_CLASS[c] for c in classes if c in _BLOCK_TYPE_BY_CLASS),
            "paragraph",
        )

        blocks.append(WolBlock(block_id=next_id, block_type=block_type, content=text))
        next_id += 1

    return blocks


def get_document(doc_id: int) -> WolDocument:
    """
    Descarga y parsea un documento de la Biblioteca en Línea por su ``docId``.

    Lanza WolError si no se puede obtener o si la página no tiene contenido
    reconocible (p. ej. un docId inexistente devuelve una página vacía).
    """
    cached = _doc_cache.get(doc_id)
    if cached is not None:
        _doc_cache.move_to_end(doc_id)
        return cached

    url = f"{_DOC_URL}/{doc_id}"
    soup = BeautifulSoup(_get(url), "html.parser")

    article = soup.select_one("article#article") or soup.select_one("#article")
    if article is None:
        raise WolError("Documento no encontrado en wol.jw.org")

    blocks = _extract_blocks(article)
    if not blocks:
        raise WolError("Documento sin contenido legible")

    # Título: el <p class="st"> del propio artículo; si no, el <title> de la
    # página quitando el sufijo del sitio.
    title_node = article.select_one("p.st")
    if title_node is not None:
        title = " ".join(title_node.get_text(" ", strip=True).split())
    elif soup.title:
        title = soup.title.get_text(strip=True).split("—")[0].strip()
    else:
        title = f"Documento {doc_id}"

    # La página del documento no publica la cita legible ("w06 1/12 págs.
    # 25-29") en ningún elemento propio — sólo aparece en los resultados de
    # búsqueda. Como sustituto usamos el símbolo de la publicación, que sí
    # viene en las clases del <article> (``pub-w06``).
    article_pubs = [
        p
        for p in (_first_match([c], _PUB_RE) for c in (article.get("class") or []))
        if p
    ]
    citation = article_pubs[-1] if article_pubs else ""

    document = WolDocument(
        doc_id=doc_id,
        title=title,
        citation=citation,
        url=url,
        blocks=blocks,
    )
    _cache_put(_doc_cache, doc_id, document, _DOC_CACHE_MAX)
    return document
