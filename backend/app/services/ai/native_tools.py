"""
Native tools — herramientas del chat implementadas en Python, sin MCP.

Por qué existen: el chat dependía por completo de ``jw-mcp`` (subprocess Node).
Si ese binario no está instalado —como pasaba en el contenedor de producción—
la lista de herramientas quedaba vacía, y como el system prompt prohíbe
responder sin consultar fuentes, el chat se volvía inútil.

Estas herramientas usan los scrapers que ya teníamos en el backend y cubren el
núcleo del caso de uso, con dos ventajas sobre el MCP:

  * Responden en ESPAÑOL (el MCP devuelve inglés y hay que traducir).
  * No dependen de Node ni de un subprocess: si hay red, funcionan.

El MCP se sigue cargando encima cuando está disponible (aporta notas de
estudio, guía de actividades y subtítulos de vídeo); estas son el suelo
garantizado, no un reemplazo.

**Dos catálogos, no uno.** ``buscar_en_biblioteca`` va a wol.jw.org y
``buscar_en_jw_org`` va a jw.org, y no son lo mismo: WOL indexa lo publicado en
papel, jw.org indexa además JW Broadcasting. Un vídeo no está en WOL. Por eso
hay dos herramientas y no una con un parámetro: el agente tiene que ver que son
dos sitios distintos para acordarse de mirar en los dos.

**Las fechas viajan con cada resultado.** Cada uno lleva su ``anio`` cuando se
puede saber, y un ``aviso_fecha`` cuando la publicación es lo bastante antigua
como para que convenga comprobar si hay algo posterior. Eso va pegado al
resultado y no en el prompt a propósito: el aviso tiene que estar delante justo
cuando el modelo está mirando esa fuente.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ..jw import pub_dates
from ..jw.daily_text import DailyTextError, fetch_daily_text
from ..jw.jw_org import JwOrgError, get_video
from ..jw.jw_org import search as search_jw_org
from ..jw.wol_library import WolError, get_document, search_library
from ..references import ReferenceResolutionError, resolve_reference
from .research_config import ResearchConfig

logger = logging.getLogger(__name__)


# Presupuesto de caracteres por documento devuelto al modelo. Un artículo de
# La Atalaya ronda los 20-30k caracteres; mandarlo entero dispara el coste y
# empuja fuera de contexto al resto de fuentes.
_MAX_DOC_CHARS = 12_000

#: Valores del parámetro ``orden`` de las dos búsquedas. Mismos nombres en las
#: dos aunque por debajo sean parámetros distintos (``r`` en WOL, ``sort`` en
#: jw.org): el modelo no tiene por qué saberlo.
_ORDER_VALUES = ("relevancia", "reciente", "antiguo")

_DATE_PARAMS = {
    "orden": {
        "type": "string",
        "enum": list(_ORDER_VALUES),
        "description": (
            "Orden de los resultados. 'relevancia' (por defecto) es el mejor "
            "para encontrar material del tema; usa 'reciente' cuando lo que "
            "importe sea el entendimiento actual."
        ),
    },
    "desde_anio": {
        "type": "integer",
        "description": (
            "Descarta publicaciones anteriores a este año. Úsalo cuando el "
            "tema haya podido cambiar de enfoque con el tiempo."
        ),
    },
    "hasta_anio": {
        "type": "integer",
        "description": "Descarta publicaciones posteriores a este año.",
    },
}


NATIVE_TOOLS: list[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "leer_pasaje_biblico",
            "description": (
                "Devuelve el texto REAL de un pasaje de la Biblia (Traducción del "
                "Nuevo Mundo, en español) desde wol.jw.org. Úsala siempre que "
                "necesites citar un versículo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "libro": {
                        "type": "string",
                        "description": "Nombre del libro en español, ej. 'Juan', 'Salmos', '1 Corintios'.",
                    },
                    "capitulo": {"type": "integer", "description": "Número de capítulo."},
                    "versiculo": {
                        "type": "string",
                        "description": (
                            "Número de versículo. Usa 'all' para el capítulo completo. "
                            "Por defecto: 'all'."
                        ),
                    },
                },
                "required": ["libro", "capitulo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_en_biblioteca",
            "description": (
                "Busca en la Biblioteca en Línea de wol.jw.org en español (Atalaya, "
                "Despertad, libros, guía de actividades). Devuelve una lista de "
                "resultados con doc_id, cita, año y fragmento. Para leer uno entero, "
                "llama después a abrir_documento con su doc_id. NO indexa vídeos: "
                "para eso está buscar_en_jw_org."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "consulta": {
                        "type": "string",
                        "description": (
                            "Palabras clave en español. Es el buscador interno de "
                            "wol.jw.org: NO admite operadores de buscador web "
                            "(site:, comillas, OR). Escribe sólo los términos."
                        ),
                    },
                    "limite": {
                        "type": "integer",
                        "description": "Máximo de resultados (1-10, por defecto 6).",
                    },
                    **_DATE_PARAMS,
                },
                "required": ["consulta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_en_jw_org",
            "description": (
                "Busca en jw.org, que es un catálogo DISTINTO al de la Biblioteca "
                "en Línea: además de artículos, indexa los VÍDEOS de JW "
                "Broadcasting, que en wol.jw.org no están. Úsala siempre que el "
                "tema pueda tener material audiovisual (experiencias, dramas, "
                "programas mensuales, discursos grabados) y para contrastar lo "
                "que encuentres en la Biblioteca. Los resultados de vídeo traen "
                "un 'lank' que se abre con abrir_video; los de artículo traen un "
                "'doc_id' que se abre con abrir_documento."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "consulta": {
                        "type": "string",
                        "description": "Palabras clave en español, sin operadores de buscador.",
                    },
                    "tipo": {
                        "type": "string",
                        "enum": ["todo", "publicaciones", "videos", "audio", "biblia"],
                        "description": (
                            "Qué buscar. 'todo' por defecto; 'videos' cuando "
                            "busques específicamente material audiovisual."
                        ),
                    },
                    "limite": {
                        "type": "integer",
                        "description": "Máximo de resultados (1-12, por defecto 6).",
                    },
                    **_DATE_PARAMS,
                },
                "required": ["consulta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "abrir_video",
            "description": (
                "Devuelve la ficha de un vídeo de jw.org y su TRANSCRIPCIÓN "
                "completa, sacada de los subtítulos oficiales. Con esto puedes "
                "citar lo que se dice en un vídeo igual que citarías un artículo. "
                "Usa el 'lank' que devolvió buscar_en_jw_org."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lank": {
                        "type": "string",
                        "description": (
                            "Identificador del vídeo, ej. 'pub-jwbcov_201705_15_VIDEO'."
                        ),
                    }
                },
                "required": ["lank"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "abrir_documento",
            "description": (
                "Devuelve el texto completo de un artículo de wol.jw.org a partir "
                "del doc_id que devolvió buscar_en_biblioteca o buscar_en_jw_org."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_id": {
                        "type": "integer",
                        "description": "Identificador del documento en wol.jw.org.",
                    }
                },
                "required": ["doc_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "obtener_texto_del_dia",
            "description": (
                "Devuelve el texto diario de hoy (Examinemos las Escrituras cada "
                "día) con su comentario, en español."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


#: Herramienta de fuentes de FUERA de jw.org. Va aparte porque solo se le
#: ofrece al modelo cuando el usuario la ha activado en Ajustes: una
#: herramienta apagada que aparece en la lista es una llamada perdida por ronda
#: y un error en el rastro de actividad.
INTERNET_TOOL: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "buscar_en_internet",
        "description": (
            "Busca en catálogos científicos de fuera de jw.org (OpenAlex, Europe "
            "PMC) para conseguir un DATO REAL y comprobable: una cifra, un "
            "experimento, un comportamiento animal, un fenómeno natural. Sirve "
            "para que las ilustraciones se apoyen en hechos con autor, revista y "
            "año en lugar de en lo que recuerdes. La consulta va MEJOR EN INGLÉS: "
            "es el idioma de la literatura científica. "
            "NO la uses para temas bíblicos ni doctrinales: para eso están las "
            "publicaciones. Si un resultado viene marcado con 'aviso_doctrinal', "
            "estás obligado a buscar la enseñanza bíblica antes de usarlo."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "consulta": {
                    "type": "string",
                    "description": "Términos de búsqueda, preferiblemente en inglés.",
                },
                "limite": {
                    "type": "integer",
                    "description": "Máximo de resultados (1-8, por defecto 5).",
                },
            },
            "required": ["consulta"],
        },
    },
}


_NATIVE_NAMES = frozenset(
    [t["function"]["name"] for t in NATIVE_TOOLS] + [INTERNET_TOOL["function"]["name"]]
)

#: Herramientas que consultan fuentes de fuera de jw.org.
EXTERNAL_TOOL_NAMES = frozenset({"buscar_en_internet"})


def is_native_tool(name: str) -> bool:
    """¿Esta herramienta la resuelve el backend en vez del MCP?"""
    return name in _NATIVE_NAMES


def tools_for(config: Optional[ResearchConfig] = None) -> list[Dict[str, Any]]:
    """Catálogo nativo de ESTA petición: el fijo, más internet si está activo."""
    if config is not None and config.internet:
        return [*NATIVE_TOOLS, INTERNET_TOOL]
    return list(NATIVE_TOOLS)


def call_native_tool(
    name: str,
    args: Dict[str, Any],
    config: Optional[ResearchConfig] = None,
) -> Dict[str, Any]:
    """
    Ejecuta una herramienta nativa. Síncrona: el llamador debe envolverla en
    ``asyncio.to_thread`` para no bloquear el event loop.

    ``config`` llega por parámetro y no por variable global: el backend atiende
    varias peticiones a la vez y la configuración de una no puede encenderle
    internet —ni apagarle el filtro— a otra.

    Nunca lanza: los fallos se devuelven como ``{"error": ...}`` para que el
    modelo pueda reaccionar (probar otra fuente) en vez de romper el stream.
    """
    settings = config or ResearchConfig.offline()
    try:
        if name == "leer_pasaje_biblico":
            return _leer_pasaje_biblico(args)
        if name == "buscar_en_biblioteca":
            return _sin_avisos(_buscar_en_biblioteca(args, settings), settings)
        if name == "buscar_en_jw_org":
            return _sin_avisos(_buscar_en_jw_org(args, settings), settings)
        if name == "abrir_video":
            return _sin_avisos(_abrir_video(args), settings)
        if name == "abrir_documento":
            return _sin_avisos(_abrir_documento(args), settings)
        if name == "obtener_texto_del_dia":
            return _obtener_texto_del_dia()
        if name == "buscar_en_internet":
            return _buscar_en_internet(args, settings)
        return {"error": f"Herramienta desconocida: {name}"}
    except Exception:  # noqa: BLE001 — el chat nunca debe caerse por una tool
        logger.exception("Herramienta nativa %s falló", name)
        return {"error": "La herramienta falló al obtener el contenido."}


def _sin_avisos(payload: Dict[str, Any], config: ResearchConfig) -> Dict[str, Any]:
    """
    Quita los avisos de antigüedad si el usuario los ha desactivado.

    Se limpia AQUÍ y no en cada extractor porque el ``anio`` sí se queda: quitar
    el aviso es decir "no me des la lata con esto", no "ocúltame la fecha".
    """
    if config.date_warnings:
        return payload

    payload.pop("aviso_fecha", None)
    for item in payload.get("resultados") or []:
        if isinstance(item, dict):
            item.pop("aviso_fecha", None)
    return payload


# ─── Parámetros comunes ──────────────────────────────────────────


def _limite(args: Dict[str, Any], default: int, maximo: int) -> int:
    try:
        value = int(args.get("limite") or default)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, maximo))


def _orden(args: Dict[str, Any]) -> str:
    raw = str(args.get("orden") or "").strip().lower()
    return raw if raw in _ORDER_VALUES else "relevancia"


def _rango(
    args: Dict[str, Any], config: ResearchConfig
) -> tuple[Optional[int], Optional[int]]:
    """
    Rango de años pedido, saneado y con los extremos en orden.

    El suelo de Ajustes (``min_year``) es un DEFAULT, no un techo: si el modelo
    pide un `desde_anio` explícito manda el suyo. Al revés —forzar siempre el de
    Ajustes— haría imposible que el agente vaya a buscar a propósito un artículo
    antiguo, que es exactamente lo que hay que hacer para comparar entendimientos.

    El modelo a veces intercambia los límites ("desde 2020 hasta 2010"). Con
    ellos al revés el filtro no deja pasar nada y el agente concluye que no hay
    material, que es la conclusión falsa más cara de todas.
    """
    desde = pub_dates.clamp_year(args.get("desde_anio"))
    hasta = pub_dates.clamp_year(args.get("hasta_anio"))
    if desde is None and hasta is None:
        desde = pub_dates.clamp_year(config.min_year)
    if desde is not None and hasta is not None and desde > hasta:
        desde, hasta = hasta, desde
    return desde, hasta


def _sin_resultados(desde: Optional[int], hasta: Optional[int], donde: str) -> Dict[str, Any]:
    """Respuesta de búsqueda vacía, diciendo si el filtro tuvo la culpa."""
    if desde is not None or hasta is not None:
        rango = f"{desde or '…'}-{hasta or '…'}"
        return {
            "resultados": [],
            "aviso": (
                f"Sin resultados en {donde} dentro del rango {rango}. Prueba a "
                "ampliar el rango de años o a quitarlo."
            ),
        }
    return {"resultados": [], "aviso": f"Sin resultados en {donde}."}


# ─── Implementaciones ────────────────────────────────────────────


def _leer_pasaje_biblico(args: Dict[str, Any]) -> Dict[str, Any]:
    libro = str(args.get("libro", "")).strip()
    if not libro:
        return {"error": "Falta el nombre del libro."}
    try:
        capitulo = int(args.get("capitulo"))
    except (TypeError, ValueError):
        return {"error": "El capítulo debe ser un número."}

    versiculo = str(args.get("versiculo") or "all").strip().lower() or "all"
    identifier = f"scripture:{libro.lower()}:{capitulo}:{versiculo}"

    try:
        resolved = resolve_reference(identifier)
    except ReferenceResolutionError as exc:
        return {"error": str(exc)}

    return {
        "titulo": resolved.title,
        "texto": resolved.content,
        "fuente": resolved.source_url,
        "idioma": "es" if resolved.source == "wol" else "en",
    }


def _buscar_en_biblioteca(
    args: Dict[str, Any], config: ResearchConfig
) -> Dict[str, Any]:
    consulta = str(args.get("consulta", "")).strip()
    if not consulta:
        return {"error": "Falta la consulta."}

    desde, hasta = _rango(args, config)

    try:
        results = search_library(
            consulta,
            limit=_limite(args, 6, 10),
            sort=_orden(args),
            since=desde,
            until=hasta,
        )
    except WolError as exc:
        return {"error": str(exc)}

    if not results:
        return _sin_resultados(desde, hasta, "wol.jw.org")

    return {"resultados": [r.to_dict() for r in results]}


#: Nombres del parámetro ``tipo`` tal como los ve el modelo → los de la API.
_JW_KINDS = {
    "todo": "all",
    "publicaciones": "publications",
    "videos": "videos",
    "audio": "audio",
    "biblia": "bible",
}


def _buscar_en_jw_org(args: Dict[str, Any], config: ResearchConfig) -> Dict[str, Any]:
    consulta = str(args.get("consulta", "")).strip()
    if not consulta:
        return {"error": "Falta la consulta."}

    tipo = _JW_KINDS.get(str(args.get("tipo") or "todo").strip().lower(), "all")
    desde, hasta = _rango(args, config)

    try:
        results = search_jw_org(
            consulta,
            kind=tipo,
            limit=_limite(args, 6, 12),
            sort=_orden(args),
            since=desde,
            until=hasta,
        )
    except JwOrgError as exc:
        return {"error": str(exc)}

    if not results:
        return _sin_resultados(desde, hasta, "jw.org")

    payload: Dict[str, Any] = {"resultados": [r.to_dict() for r in results]}
    if any(r.kind == "video" for r in results):
        # El agente tiende a citar el vídeo por el título y quedarse ahí. La
        # transcripción es justo lo que le permite citarlo de verdad.
        payload["siguiente_paso"] = (
            "Los resultados de vídeo no traen su contenido: ábrelos con "
            "abrir_video para leer la transcripción antes de citarlos."
        )
    return payload


def _abrir_video(args: Dict[str, Any]) -> Dict[str, Any]:
    lank = str(args.get("lank", "")).strip()
    if not lank:
        return {"error": "Falta el identificador del vídeo (lank)."}

    try:
        video = get_video(lank)
    except JwOrgError as exc:
        return {"error": str(exc)}

    payload = video.to_dict()
    if not payload.get("transcripcion"):
        payload["aviso"] = (
            "Este vídeo no tiene subtítulos publicados, así que no hay "
            "transcripción. No cites su contenido: solo su título y su fecha."
        )
    return payload


def _abrir_documento(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        doc_id = int(args.get("doc_id"))
    except (TypeError, ValueError):
        return {"error": "doc_id debe ser un número."}

    try:
        document = get_document(doc_id)
    except WolError as exc:
        return {"error": str(exc)}

    text = document.plain_text
    truncated = len(text) > _MAX_DOC_CHARS
    payload: Dict[str, Any] = {
        "titulo": document.title,
        "publicacion": document.citation,
        "anio": document.year,
        "fuente": document.url,
        "texto": text[:_MAX_DOC_CHARS],
        "truncado": truncated,
    }
    nota = pub_dates.freshness_note(document.year)
    if nota:
        payload["aviso_fecha"] = nota
    return payload


def _obtener_texto_del_dia() -> Dict[str, Any]:
    try:
        return fetch_daily_text().to_dict()
    except DailyTextError as exc:
        return {"error": str(exc)}


def _buscar_en_internet(args: Dict[str, Any], config: ResearchConfig) -> Dict[str, Any]:
    consulta = str(args.get("consulta", "")).strip()
    if not consulta:
        return {"error": "Falta la consulta."}

    # Import perezoso: ``external.web_search`` arrastra httpx y los catálogos, y
    # el 95 % de los turnos no llegan aquí nunca.
    from ..external import web_search

    from dataclasses import replace

    try:
        report = web_search.search(
            consulta,
            replace(config, max_results=_limite(args, config.max_results or 5, 8)),
        )
    except (web_search.WebSearchDisabled, web_search.WebSearchError) as exc:
        return {"error": str(exc)}

    return report.to_dict()


__all__ = [
    "EXTERNAL_TOOL_NAMES",
    "INTERNET_TOOL",
    "NATIVE_TOOLS",
    "call_native_tool",
    "is_native_tool",
    "tools_for",
]
