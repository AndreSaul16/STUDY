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

from . import content_cache, pub_dates

logger = logging.getLogger(__name__)

# ─── Configuración ───────────────────────────────────────────────
_WOL_ORIGIN = "https://wol.jw.org"
_SEARCH_URL = f"{_WOL_ORIGIN}/es/wol/s/r4/lp-s"
_DOC_URL = f"{_WOL_ORIGIN}/es/wol/d/r4/lp-s"
_TIMEOUT_SECONDS = 20.0
_USER_AGENT = "StudyApp/1.0 (+https://wol.jw.org)"

#: Ordenación del buscador de WOL (parámetro ``r``), con el nombre que usa la
#: app por delante. Los valores son los del propio desplegable de wol.jw.org:
#: "Ordenar según frecuencia", "…por fecha más reciente", "…más antigua".
SORT_MODES = {
    "relevancia": "occ",
    "reciente": "newest",
    "antiguo": "oldest",
}

#: Escalera de cercanía del buscador de WOL (parámetro ``p``), de más estricta
#: a más laxa: misma oración → mismo párrafo → mismo artículo.
#:
#: **Este es el arreglo del fallo más molesto que tenía la app.** El código
#: pedía siempre ``par`` (mismo párrafo), que exige que TODOS los términos
#: aparezcan juntos en un mismo párrafo. Con dos o tres palabras va de sobra,
#: pero con una pregunta en lenguaje natural no casa nada. Medido contra WOL con
#: la consulta real "usar jw.org alguien habla otro idioma predicación":
#:
#:     p=sen → 0 resultados
#:     p=par → 0 resultados     ← lo que pedía la app siempre
#:     p=doc → 17 resultados
#:
#: Es decir: el material estaba ahí y el agente concluía "no encontré nada" y se
#: negaba a responder. Ahora se empieza por lo preciso y solo se relaja si no
#: hay nada, así que las consultas cortas conservan su precisión de siempre y
#: las largas dejan de morir. El coste es una petición extra únicamente cuando
#: la primera fracasa, que es justo el caso en el que la app no servía.
PROXIMITY_LADDER = ("par", "doc")

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

    @property
    def year(self) -> int | None:
        """
        Año de la publicación, deducido de la cita o del símbolo.

        Aquí sí es fiable: la cita de WOL tiene formato ("símbolo fecha págs. …
        - Publicación AAAA"), a diferencia de los títulos de la búsqueda de
        jw.org. Es ``None`` en libros y obras de referencia sin año.
        """
        return pub_dates.year_from_citation(self.citation) or pub_dates.year_from_symbol(
            self.publication
        )

    def to_dict(self) -> dict:
        data = asdict(self)
        data["anio"] = self.year
        nota = pub_dates.freshness_note(self.year)
        if nota:
            data["aviso_fecha"] = nota
        return data


@dataclass(frozen=True)
class WolBlock:
    """Un bloque de contenido dentro de un documento."""

    block_id: int
    block_type: str
    content: str
    paragraph_id: int | None = None
    """
    Número de párrafo de la publicación (atributo ``data-pid`` de WOL).

    NO es lo mismo que ``block_id``, que es un contador nuestro. Este es el
    identificador que usa JW Library en ``BlockRange.Identifier`` para anclar
    un subrayado, así que es imprescindible para que una marca hecha aquí
    caiga en el párrafo correcto al volver al móvil. Es None en los bloques
    que WOL no numera (títulos, encabezados).
    """

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

    @property
    def year(self) -> int | None:
        """
        Año de la publicación, deducido del símbolo del ``<article>``.

        Es la única fecha que publica la página del documento, y es fiable:
        ``pub-mwb19`` es la guía de actividades de 2019, ``pub-w06`` La Atalaya
        de 2006. ``None`` en libros y obras de referencia sin año (``pub-it-1``,
        ``pub-cf``), que no caducan.
        """
        return pub_dates.year_from_symbol(self.citation)

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


def _parse_results(html: str, limit: int) -> list[SearchResult]:
    """
    Convierte la página de resultados de WOL en objetos del dominio.

    Está aparte de ``search_library`` porque la escalera de cercanía la llama
    una vez por intento; en línea habría que duplicarla o meter el parseo en un
    bucle que ya hace otra cosa.
    """
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

    return results


def search_library(
    query: str,
    limit: int = 8,
    sort: str | None = None,
    since: int | None = None,
    until: int | None = None,
) -> list[SearchResult]:
    """
    Busca ``query`` en la Biblioteca en Línea (español) y devuelve los
    resultados más relevantes.

    ``sort`` usa la ordenación del propio WOL (``r=occ|newest|oldest``), y
    ``since``/``until`` recortan por año DESPUÉS, porque WOL no tiene filtro de
    rango. Con filtro activo se piden más resultados de los que se devuelven,
    para no acabar con dos por un detalle de implementación. Lo que no lleva
    año en la cita —libros, Perspicacia— nunca se descarta.
    """
    clean = " ".join(query.split())
    if not clean:
        return []

    tope = max(1, min(int(limit or 8), 20))
    hay_filtro = since is not None or until is not None
    # Relevancia también cuando hay filtro de años. Se probó lo contrario
    # —pedir a WOL ``newest`` cuando llega ``desde_anio``— y sale peor: la
    # ordenación por fecha de WOL saca primero las obras sin año (Biblia de
    # estudio, cancionero) y las Atalayas recientes del tema no aparecen. Con
    # relevancia + recorte salen los artículos que de verdad tratan el tema.
    orden = SORT_MODES.get(sort or "relevancia", "occ")
    # Con filtro se pide de más, porque el recorte por año es posterior: pedir
    # 6 y quedarse con 1 es la diferencia entre un filtro útil y uno que
    # aparenta que no hay material.
    pedidos = min(tope * 5, 50) if hay_filtro else tope

    cache_key = f"{clean}|{pedidos}|{orden}"
    cached = _search_cache.get(cache_key)
    if cached is None:
        # Caché en disco: sobrevive al reinicio y no tiene el tope de la de
        # memoria. Las búsquedas caducan porque WOL sí añade publicaciones.
        persistido = content_cache.get("search", cache_key)
        if persistido is not None:
            cached = [SearchResult(**r) for r in _without_derived(persistido)]
            _cache_put(_search_cache, cache_key, cached, _SEARCH_CACHE_MAX)

    if cached is not None:
        if cache_key in _search_cache:
            _search_cache.move_to_end(cache_key)
        return _apply_year_filter(cached, since, until, tope)

    # Cercanía progresiva: si la más estricta no encuentra nada, se relaja.
    # Ver PROXIMITY_LADDER para el porqué; es el arreglo de la queja más
    # frecuente del usuario ("Sin resultados" una y otra vez).
    results: list[SearchResult] = []
    for cercania in PROXIMITY_LADDER:
        html = _get(_SEARCH_URL, params={"q": clean, "p": cercania, "r": orden})
        results = _parse_results(html, pedidos)
        if results:
            break
        logger.info(
            "WOL no devolvió nada para %r con p=%s; relajando la cercanía.",
            clean,
            cercania,
        )

    _cache_put(_search_cache, cache_key, results, _SEARCH_CACHE_MAX)
    content_cache.put(
        "search",
        cache_key,
        [r.to_dict() for r in results],
        ttl_seconds=content_cache.search_ttl(),
    )
    return _apply_year_filter(results, since, until, tope)


#: Campos que ``to_dict`` añade y que el constructor de ``SearchResult`` no
#: acepta. Se calculan del año, que a su vez sale de la cita: guardarlos en la
#: caché está bien (son lo que se le enseña al modelo), pero al reconstruir el
#: objeto hay que quitarlos o el ``SearchResult(**r)`` revienta con un
#: TypeError. Pasó con una caché ya escrita: la app arrancaba y la primera
#: búsqueda repetida fallaba.
_DERIVED_FIELDS = ("anio", "aviso_fecha")


def _without_derived(rows: list[dict]) -> list[dict]:
    return [
        {k: v for k, v in row.items() if k not in _DERIVED_FIELDS}
        for row in rows
        if isinstance(row, dict)
    ]


def _apply_year_filter(
    results: list[SearchResult],
    since: int | None,
    until: int | None,
    limit: int,
) -> list[SearchResult]:
    """Recorta por rango de años y por número. Lo no fechable siempre pasa."""
    if since is None and until is None:
        return results[:limit]
    return [r for r in results if pub_dates.within_range(r.year, since, until)][:limit]


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

        raw_pid = para.get("data-pid")
        try:
            paragraph_id = int(raw_pid) if raw_pid is not None else None
        except (TypeError, ValueError):
            paragraph_id = None

        blocks.append(
            WolBlock(
                block_id=next_id,
                block_type=block_type,
                content=text,
                paragraph_id=paragraph_id,
            )
        )
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

    # Permanente: un artículo publicado no cambia. Descargarlo una vez basta.
    persistido = content_cache.get("document", str(doc_id))
    if persistido is not None:
        document = WolDocument(
            doc_id=persistido["doc_id"],
            title=persistido["title"],
            citation=persistido["citation"],
            url=persistido["url"],
            blocks=[WolBlock(**b) for b in persistido["blocks"]],
        )
        _cache_put(_doc_cache, doc_id, document, _DOC_CACHE_MAX)
        return document

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
    #
    # El <article> trae VARIOS: la familia sin año y la edición con año
    # ("pub-mwb" y "pub-mwb19", repetidos). Se prefiere el que lleva año, que
    # es el único que sirve para fechar el documento; coger "el último" era
    # correcto por casualidad, según el orden en que WOL escupa las clases.
    article_pubs = [
        p
        for p in (_first_match([c], _PUB_RE) for c in (article.get("class") or []))
        if p
    ]
    con_anio = [p for p in article_pubs if pub_dates.year_from_symbol(p) is not None]
    citation = (con_anio or article_pubs or [""])[-1]

    document = WolDocument(
        doc_id=doc_id,
        title=title,
        citation=citation,
        url=url,
        blocks=blocks,
    )
    _cache_put(_doc_cache, doc_id, document, _DOC_CACHE_MAX)
    content_cache.put("document", str(doc_id), document.to_dict())
    return document
