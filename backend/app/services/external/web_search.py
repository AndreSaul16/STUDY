"""
Búsqueda fuera de jw.org — literatura científica y fuentes de referencia.

Para qué sirve, si la app investiga en las publicaciones: para el **dato duro
de una ilustración**. El modo ILUSTRACIÓN exige un hecho real y comprobable con
una cifra concreta, y prohíbe inventarlo. Hasta ahora ese dato salía de la
memoria del modelo, que es exactamente donde no debe salir. Aquí se busca de
verdad, y lo que se cita tiene autor, revista y año.

Está APAGADO por defecto. Solo se activa desde Ajustes, y solo para el modo de
investigación profunda.

**Lista blanca, no lista negra.** La decisión de fondo del módulo: no se busca
"en internet" y luego se filtra la basura — se busca únicamente en catálogos
cuya reputación es la razón de existir del catálogo. Filtrar a posteriori
supone acertar con todo lo que hay que excluir; buscar solo en sitios buenos
supone acertar con lo que hay que incluir, que es una lista finita y revisable.

Dos catálogos, ambos públicos y sin clave (verificados en vivo):

  * **OpenAlex** — 250 millones de trabajos académicos, con revista, año,
    número de citas, DOI y acceso abierto. Es el catálogo generalista.
  * **Europe PMC** — biomedicina y ciencias de la vida, con resumen completo.

Y una tercera vía OPCIONAL: un buscador web generalista (Brave o Tavily) que
solo se enciende si el usuario configura su clave, y cuyos resultados se
recortan además contra una lista blanca de dominios de referencia. Sin clave,
esta vía sencillamente no existe y la búsqueda es solo académica.

Todo lo que sale de aquí pasa por ``ai/doctrinal_filter`` antes de llegar al
modelo.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from ..ai import doctrinal_filter
from ..ai.research_config import DEFAULT_SCOPE, SCOPES, ResearchConfig
from ..jw import content_cache

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 20.0

#: OpenAlex pide un correo de contacto para darte el carril rápido. Si no hay
#: ninguno configurado se va por el carril común, que también funciona.
_CONTACT = os.getenv("RESEARCH_CONTACT_EMAIL", "").strip()
_USER_AGENT = (
    f"StudyApp/1.0 (mailto:{_CONTACT})" if _CONTACT else "StudyApp/1.0"
)

_OPENALEX_URL = "https://api.openalex.org/works"
_EUROPEPMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

#: Los resúmenes académicos son largos. Esto es lo que llega al modelo por
#: resultado; con seis resultados ya son 4.000 caracteres de contexto.
_MAX_ABSTRACT_CHARS = 700

#: Una búsqueda externa caduca antes que una de WOL: la literatura crece.
_CACHE_TTL_SECONDS = 3 * 24 * 3600


#: Dominios de referencia admitidos en el ámbito "ampliado". Criterio: o es una
#: institución que publica sus propios datos (agencias espaciales, sanitarias,
#: meteorológicas, museos) o es una editorial científica. Nada de medios de
#: opinión, nada de agregadores, nada de foros.
REPUTABLE_DOMAINS = frozenset(
    {
        # Ciencia y editoriales
        "nature.com",
        "science.org",
        "sciencedirect.com",
        "springer.com",
        "cell.com",
        "pnas.org",
        "thelancet.com",
        "nejm.org",
        "bmj.com",
        "plos.org",
        "royalsocietypublishing.org",
        "arxiv.org",
        "scientificamerican.com",
        "newscientist.com",
        # Instituciones públicas
        "nasa.gov",
        "esa.int",
        "noaa.gov",
        "usgs.gov",
        "nih.gov",
        "ncbi.nlm.nih.gov",
        "cdc.gov",
        "who.int",
        "fao.org",
        "unesco.org",
        "europa.eu",
        "csic.es",
        "aemet.es",
        "ign.es",
        # Museos, universidades y enciclopedias editadas
        "britannica.com",
        "si.edu",
        "nhm.ac.uk",
        "amnh.org",
        "mpg.de",
        "cam.ac.uk",
        "ox.ac.uk",
        "mit.edu",
        "stanford.edu",
        "harvard.edu",
        "nationalgeographic.com",
    }
)


class WebSearchError(Exception):
    """Fallo al consultar una fuente externa. No expone trazas internas."""


class WebSearchDisabled(Exception):
    """La búsqueda externa no está activada para esta investigación."""


#: Alias histórico. La configuración vive ahora en ``ai/research_config`` porque
#: gobierna más cosas que la búsqueda web (el filtro doctrinal, los avisos de
#: fecha) y tenerla aquí obligaba a importar este módulo desde sitios que no
#: buscan nada.
WebSearchConfig = ResearchConfig


# ─── Resultado ───────────────────────────────────────────────────


@dataclass(frozen=True)
class ExternalResult:
    """Un resultado de fuera de jw.org, ya normalizado."""

    title: str
    url: str
    summary: str
    source: str
    """Revista, institución o dominio del que sale."""
    year: Optional[int] = None
    authors: str = ""
    citations: Optional[int] = None
    """Veces que se ha citado. Es el indicador de solidez que da OpenAlex."""
    catalog: str = ""
    """"openalex" | "europepmc" | "web"."""
    open_access: bool = False

    def to_dict(self) -> dict:
        data: dict[str, Any] = {
            "titulo": self.title,
            "url": self.url,
            "resumen": self.summary,
            "publicado_en": self.source,
            "catalogo": self.catalog,
        }
        if self.year is not None:
            data["anio"] = self.year
        if self.authors:
            data["autores"] = self.authors
        if self.citations is not None:
            data["veces_citado"] = self.citations
        if self.open_access:
            data["acceso_abierto"] = True
        return data


# ─── Configuración por petición ──────────────────────────────────


# ─── Utilidades ──────────────────────────────────────────────────


def _get(url: str, params: dict, headers: Optional[dict] = None) -> dict:
    try:
        response = httpx.get(
            url,
            params=params,
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT, **(headers or {})},
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:  # noqa: BLE001 — red, DNS, 4xx/5xx, JSON roto…
        logger.warning("Consulta externa fallida (%s): %s", url, exc)
        raise WebSearchError("No se pudo consultar la fuente externa") from exc


def _shorten(text: str, limit: int = _MAX_ABSTRACT_CHARS) -> str:
    clean = " ".join((text or "").split())
    if len(clean) <= limit:
        return clean
    # Cortar por la última frase completa que quepa: un resumen partido a
    # mitad de palabra parece un error de la herramienta.
    recortado = clean[:limit]
    punto = recortado.rfind(". ")
    return (recortado[: punto + 1] if punto > limit // 2 else recortado) + " […]"


def _host(url: str) -> str:
    try:
        host = (urlparse(url or "").hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _is_reputable(url: str) -> bool:
    host = _host(url)
    if not host:
        return False
    return host in REPUTABLE_DOMAINS or any(
        host.endswith(f".{domain}") for domain in REPUTABLE_DOMAINS
    )


# ─── OpenAlex ────────────────────────────────────────────────────


def _rebuild_abstract(inverted: Any) -> str:
    """
    Reconstruye el resumen desde el índice invertido de OpenAlex.

    OpenAlex no guarda el resumen como texto sino como ``{palabra: [posiciones]}``
    (por licencia). Devolverlo sin reconstruir sería darle al modelo una bolsa
    de palabras desordenada.
    """
    if not isinstance(inverted, dict) or not inverted:
        return ""

    posiciones: list[tuple[int, str]] = []
    for palabra, indices in inverted.items():
        if not isinstance(indices, list):
            continue
        for index in indices:
            if isinstance(index, int):
                posiciones.append((index, str(palabra)))

    if not posiciones:
        return ""
    posiciones.sort()
    return " ".join(palabra for _, palabra in posiciones)


def _openalex_authors(work: dict, limit: int = 3) -> str:
    nombres: list[str] = []
    for authorship in (work.get("authorships") or [])[:limit]:
        if not isinstance(authorship, dict):
            continue
        autor = authorship.get("author")
        if isinstance(autor, dict) and autor.get("display_name"):
            nombres.append(str(autor["display_name"]))
    total = len(work.get("authorships") or [])
    if total > len(nombres):
        nombres.append("et al.")
    return ", ".join(nombres)


def search_openalex(
    query: str, limit: int = 5, min_year: Optional[int] = None
) -> list[ExternalResult]:
    """
    Literatura académica generalista, por relevancia.

    Se probó ordenar por número de citas y sale mal: para "endurance running
    physiology" devolvía las guías de actividad física de la OMS (11.000 citas,
    otro tema). El número de citas mide impacto, no que el artículo trate de lo
    que preguntaste. Se deja el orden por relevancia de OpenAlex y las citas
    viajan en el resultado para que el agente juzgue la solidez.
    """
    filtros = ["is_retracted:false"]
    if min_year:
        filtros.append(f"from_publication_date:{int(min_year)}-01-01")

    payload = _get(
        _OPENALEX_URL,
        {
            "search": query,
            "per-page": max(1, min(limit, 20)),
            "filter": ",".join(filtros),
            "sort": "relevance_score:desc",
        },
    )

    resultados: list[ExternalResult] = []
    for work in payload.get("results") or []:
        if not isinstance(work, dict):
            continue
        titulo = " ".join(str(work.get("title") or "").split())
        if not titulo:
            continue

        location = work.get("primary_location")
        fuente = ""
        url = ""
        if isinstance(location, dict):
            origen = location.get("source")
            if isinstance(origen, dict):
                fuente = str(origen.get("display_name") or "")
            url = str(location.get("landing_page_url") or "")
        url = url or str(work.get("doi") or "")

        acceso = work.get("open_access")
        abierto = bool(isinstance(acceso, dict) and acceso.get("is_oa"))

        resultados.append(
            ExternalResult(
                title=titulo,
                url=url,
                summary=_shorten(_rebuild_abstract(work.get("abstract_inverted_index"))),
                source=fuente or "OpenAlex",
                year=work.get("publication_year")
                if isinstance(work.get("publication_year"), int)
                else None,
                authors=_openalex_authors(work),
                citations=work.get("cited_by_count")
                if isinstance(work.get("cited_by_count"), int)
                else None,
                catalog="openalex",
                open_access=abierto,
            )
        )
    return resultados


# ─── Europe PMC ──────────────────────────────────────────────────


def search_europepmc(
    query: str, limit: int = 4, min_year: Optional[int] = None
) -> list[ExternalResult]:
    """Biomedicina y ciencias de la vida. Trae el resumen ya en texto."""
    consulta = query
    if min_year:
        consulta = f"{query} AND (FIRST_PDATE:[{int(min_year)}-01-01 TO 3000-01-01])"

    payload = _get(
        _EUROPEPMC_URL,
        {
            "query": consulta,
            "format": "json",
            "pageSize": max(1, min(limit, 20)),
            "resultType": "core",
        },
    )

    lista = ((payload.get("resultList") or {}).get("result")) or []
    resultados: list[ExternalResult] = []
    for item in lista:
        if not isinstance(item, dict):
            continue
        titulo = " ".join(str(item.get("title") or "").split())
        if not titulo:
            continue

        doi = str(item.get("doi") or "")
        pmid = str(item.get("pmid") or "")
        if doi:
            url = f"https://doi.org/{doi}"
        elif pmid:
            url = f"https://europepmc.org/article/MED/{pmid}"
        else:
            url = ""

        try:
            year = int(str(item.get("pubYear") or "").strip())
        except ValueError:
            year = None

        try:
            citas = int(item.get("citedByCount"))
        except (TypeError, ValueError):
            citas = None

        resultados.append(
            ExternalResult(
                title=titulo,
                url=url,
                summary=_shorten(str(item.get("abstractText") or "")),
                source=str(item.get("journalTitle") or "Europe PMC"),
                year=year,
                authors=" ".join(str(item.get("authorString") or "").split())[:160],
                citations=citas,
                catalog="europepmc",
                open_access=str(item.get("isOpenAccess") or "").upper() == "Y",
            )
        )
    return resultados


# ─── Web generalista (opcional, requiere clave) ──────────────────


def general_web_provider() -> str:
    """
    Proveedor de búsqueda web configurado, o cadena vacía.

    Sin ``WEB_SEARCH_API_KEY`` esta vía no existe: el ámbito "ampliado" se
    comporta como "científico" y se avisa de por qué. Preferimos degradar con
    explicación a fingir que se buscó en la web abierta.
    """
    if not os.getenv("WEB_SEARCH_API_KEY", "").strip():
        return ""
    provider = os.getenv("WEB_SEARCH_PROVIDER", "brave").strip().lower()
    return provider if provider in {"brave", "tavily"} else "brave"


def _search_brave(query: str, limit: int) -> list[ExternalResult]:
    payload = _get(
        "https://api.search.brave.com/res/v1/web/search",
        {"q": query, "count": max(1, min(limit * 3, 20))},
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": os.getenv("WEB_SEARCH_API_KEY", "").strip(),
        },
    )
    crudos = ((payload.get("web") or {}).get("results")) or []
    return [
        ExternalResult(
            title=" ".join(str(item.get("title") or "").split()),
            url=str(item.get("url") or ""),
            summary=_shorten(str(item.get("description") or "")),
            source=_host(str(item.get("url") or "")),
            catalog="web",
        )
        for item in crudos
        if isinstance(item, dict) and item.get("title") and item.get("url")
    ]


def _search_tavily(query: str, limit: int) -> list[ExternalResult]:
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": os.getenv("WEB_SEARCH_API_KEY", "").strip(),
                "query": query,
                "max_results": max(1, min(limit * 3, 20)),
                "include_domains": sorted(REPUTABLE_DOMAINS),
            },
            timeout=_TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Consulta a Tavily fallida: %s", exc)
        raise WebSearchError("No se pudo consultar la fuente externa") from exc

    return [
        ExternalResult(
            title=" ".join(str(item.get("title") or "").split()),
            url=str(item.get("url") or ""),
            summary=_shorten(str(item.get("content") or "")),
            source=_host(str(item.get("url") or "")),
            catalog="web",
        )
        for item in (payload.get("results") or [])
        if isinstance(item, dict) and item.get("title") and item.get("url")
    ]


def search_general_web(query: str, limit: int = 4) -> list[ExternalResult]:
    """
    Buscador web generalista, recortado a la lista blanca de dominios.

    El recorte se aplica SIEMPRE, aunque el proveedor ya admita filtro de
    dominios: no delegamos en la API de un tercero la única barrera que separa
    al agente de la web abierta.
    """
    provider = general_web_provider()
    if not provider:
        return []

    crudos = _search_tavily(query, limit) if provider == "tavily" else _search_brave(
        query, limit
    )
    return [r for r in crudos if _is_reputable(r.url)][:limit]


# ─── Punto de entrada ────────────────────────────────────────────


@dataclass
class SearchReport:
    """Lo que devuelve una búsqueda externa, con sus avisos."""

    results: list[dict] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    """Temas doctrinales a contrastar detectados entre los resultados."""
    blocked: int = 0
    notice: str = ""

    def to_dict(self) -> dict:
        data: dict[str, Any] = {"resultados": self.results}
        if self.notice:
            data["aviso"] = self.notice
        if self.blocked:
            data["descartados"] = self.blocked
        if self.topics:
            # Viaja en el payload de la herramienta para que el motor de
            # investigación pueda recogerlo sin volver a analizar los textos:
            # es la lista de deberes bíblicos pendientes de este turno.
            data["temas_a_contrastar"] = list(self.topics)
        return data


def search(query: str, config: ResearchConfig) -> SearchReport:
    """
    Busca fuera de jw.org y devuelve resultados ya filtrados.

    Los catálogos se consultan en cadena y un fallo de uno NO tumba la
    búsqueda: si OpenAlex está caído pero Europe PMC responde, se devuelve lo
    de Europe PMC. Devolver algo con un aviso es mejor que devolver un error.
    """
    if not config.internet:
        raise WebSearchDisabled(
            "La búsqueda en internet está desactivada. Actívala en Ajustes → "
            "Investigación."
        )

    clean = " ".join((query or "").split())
    if not clean:
        return SearchReport(notice="Falta la consulta.")

    tope = max(1, min(int(config.max_results or 6), 12))
    cache_key = f"{config.scope}|{tope}|{config.min_year or 0}|{clean}"
    cacheado = content_cache.get("web_search", cache_key)

    if cacheado is None:
        crudos: list[ExternalResult] = []
        fallos: list[str] = []

        reparto = max(2, tope // 2 + 1)
        for nombre, buscador in (
            ("OpenAlex", lambda: search_openalex(clean, reparto, config.min_year)),
            ("Europe PMC", lambda: search_europepmc(clean, reparto, config.min_year)),
        ):
            try:
                crudos.extend(buscador())
            except WebSearchError:
                fallos.append(nombre)

        # Si el servidor tiene buscador web configurado se aprovecha, y si no,
        # la búsqueda es solo académica y punto. No se avisa de que falta: el
        # usuario no pidió web abierta, pidió buscar en internet, y los
        # catálogos científicos son internet.
        if config.allows_general_web and general_web_provider():
            try:
                crudos.extend(search_general_web(clean, reparto))
            except WebSearchError:
                fallos.append("el buscador web")

        cacheado = {
            "items": [r.to_dict() for r in _dedupe(crudos)][: tope * 2],
            "fallos": fallos,
        }
        content_cache.put(
            "web_search", cache_key, cacheado, ttl_seconds=_CACHE_TTL_SECONDS
        )

    # El filtro se aplica a la SALIDA de la caché, no a la entrada: así apagarlo
    # o encenderlo en Ajustes tiene efecto inmediato sobre lo ya cacheado, en
    # vez de depender de qué configuración estaba activa cuando se guardó.
    crudos = list(cacheado.get("items") or [])
    if config.doctrinal_filter:
        supervivientes, temas, bloqueados = doctrinal_filter.filter_results(crudos)
    else:
        supervivientes, temas, bloqueados = crudos, [], 0

    avisos: list[str] = []
    for fallo in cacheado.get("fallos") or []:
        avisos.append(f"No se pudo consultar {fallo}.")
    if bloqueados:
        avisos.append(
            f"Se han descartado {bloqueados} resultado(s) por venir de fuentes "
            "de oposición."
        )
    if not supervivientes:
        avisos.append("Sin resultados aprovechables en las fuentes externas.")

    return SearchReport(
        results=supervivientes[:tope],
        topics=temas,
        blocked=bloqueados,
        notice=" ".join(avisos),
    )


def _dedupe(results: list[ExternalResult]) -> list[ExternalResult]:
    """Quita duplicados por título normalizado: OpenAlex y PMC se solapan."""
    vistos: set[str] = set()
    unicos: list[ExternalResult] = []
    for item in results:
        clave = doctrinal_filter.normalize(item.title)[:120]
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(item)
    return unicos


__all__ = [
    "DEFAULT_SCOPE",
    "ExternalResult",
    "REPUTABLE_DOMAINS",
    "SCOPES",
    "ResearchConfig",
    "SearchReport",
    "WebSearchConfig",
    "WebSearchDisabled",
    "WebSearchError",
    "general_web_provider",
    "search",
    "search_europepmc",
    "search_openalex",
]
