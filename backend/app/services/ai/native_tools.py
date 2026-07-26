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
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from ..jw.daily_text import DailyTextError, fetch_daily_text
from ..jw.wol_library import WolError, get_document, search_library
from ..references import ReferenceResolutionError, resolve_reference

logger = logging.getLogger(__name__)


# Presupuesto de caracteres por documento devuelto al modelo. Un artículo de
# La Atalaya ronda los 20-30k caracteres; mandarlo entero dispara el coste y
# empuja fuera de contexto al resto de fuentes.
_MAX_DOC_CHARS = 12_000


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
                "resultados con doc_id, cita y fragmento. Para leer uno entero, "
                "llama después a abrir_documento con su doc_id."
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
                },
                "required": ["consulta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "abrir_documento",
            "description": (
                "Devuelve el texto completo de un artículo de wol.jw.org a partir "
                "del doc_id que devolvió buscar_en_biblioteca."
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

_NATIVE_NAMES = frozenset(t["function"]["name"] for t in NATIVE_TOOLS)


def is_native_tool(name: str) -> bool:
    """¿Esta herramienta la resuelve el backend en vez del MCP?"""
    return name in _NATIVE_NAMES


def call_native_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ejecuta una herramienta nativa. Síncrona: el llamador debe envolverla en
    ``asyncio.to_thread`` para no bloquear el event loop.

    Nunca lanza: los fallos se devuelven como ``{"error": ...}`` para que el
    modelo pueda reaccionar (probar otra fuente) en vez de romper el stream.
    """
    try:
        if name == "leer_pasaje_biblico":
            return _leer_pasaje_biblico(args)
        if name == "buscar_en_biblioteca":
            return _buscar_en_biblioteca(args)
        if name == "abrir_documento":
            return _abrir_documento(args)
        if name == "obtener_texto_del_dia":
            return _obtener_texto_del_dia()
        return {"error": f"Herramienta desconocida: {name}"}
    except Exception:  # noqa: BLE001 — el chat nunca debe caerse por una tool
        logger.exception("Herramienta nativa %s falló", name)
        return {"error": "La herramienta falló al obtener el contenido."}


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


def _buscar_en_biblioteca(args: Dict[str, Any]) -> Dict[str, Any]:
    consulta = str(args.get("consulta", "")).strip()
    if not consulta:
        return {"error": "Falta la consulta."}

    try:
        limite = int(args.get("limite") or 6)
    except (TypeError, ValueError):
        limite = 6
    limite = max(1, min(limite, 10))

    try:
        results = search_library(consulta, limit=limite)
    except WolError as exc:
        return {"error": str(exc)}

    if not results:
        return {"resultados": [], "aviso": "Sin resultados en wol.jw.org."}

    return {"resultados": [r.to_dict() for r in results]}


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
    return {
        "titulo": document.title,
        "publicacion": document.citation,
        "fuente": document.url,
        "texto": text[:_MAX_DOC_CHARS],
        "truncado": truncated,
    }


def _obtener_texto_del_dia() -> Dict[str, Any]:
    try:
        return fetch_daily_text().to_dict()
    except DailyTextError as exc:
        return {"error": str(exc)}
