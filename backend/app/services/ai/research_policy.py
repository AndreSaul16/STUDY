"""
Research policy — reglas que gobiernan la calidad de la investigación.

El system prompt ya prohíbe responder sin consultar fuentes, pero un prompt es
una petición, no una garantía: el modelo a veces se conforma con un fragmento
de búsqueda y redacta. Estas funciones detectan esos huecos DESPUÉS de las
rondas de herramientas y devuelven el recordatorio que hay que inyectar para
forzar una ronda más.

Todo son funciones puras (sin red, sin estado): la política se puede testear
en una tabla de casos.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional

from .chat_modes import ModeSpec

# Herramientas que devuelven el texto bíblico literal. Sin una de estas no se
# puede entrecomillar la expresión clave, que es el gancho de la voz del usuario.
SCRIPTURE_TOOLS = frozenset({"leer_pasaje_biblico", "get_verse_with_study", "get_bible_verse"})

# Herramientas que devuelven el cuerpo de un artículo (no un fragmento).
DOCUMENT_TOOLS = frozenset(
    {"abrir_documento", "getWatchtowerContent", "getWorkbookContent"}
)

SEARCH_TOOLS = frozenset(
    {"buscar_en_biblioteca", "getWatchtowerLinks", "getWorkbookLinks", "search_bible_books"}
)

# Modos cuya pieza exige el texto bíblico literal delante.
_MODES_THAT_NEED_SCRIPTURE = frozenset({"comentario", "ilustracion", "discurso"})

_GAP_NO_TOOLS = (
    "No has consultado ninguna fuente todavía. Está prohibido redactar de "
    "memoria: llama ahora a las herramientas para buscar el material en "
    "wol.jw.org antes de escribir nada."
)

_GAP_SEARCH_WITHOUT_DOCUMENT = (
    "Has buscado pero no has abierto ningún artículo. Un fragmento de búsqueda "
    "no basta: abre el más relevante con abrir_documento antes de redactar."
)

_GAP_NO_SCRIPTURE = (
    "Necesitas el texto bíblico literal para poder entrecomillar la expresión "
    "clave. Léelo con leer_pasaje_biblico."
)


def executed_tool_names(messages: Iterable[Dict[str, Any]]) -> List[str]:
    """
    Nombres de las herramientas que el modelo pidió, en orden.

    Se leen de los mensajes ``assistant`` con ``tool_calls`` (que es lo que
    acumula el bucle de chat_service), no de los ``tool``: el mensaje de rol
    ``tool`` solo lleva el ``tool_call_id``, no el nombre.
    """
    names: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            name = (call.get("function") or {}).get("name")
            if isinstance(name, str) and name:
                names.append(name)
    return names


def research_gap(executed: Iterable[str], mode: ModeSpec) -> Optional[str]:
    """
    ¿Falta investigación antes de redactar?

    Devuelve el texto del recordatorio a inyectar como mensaje de sistema, o
    ``None`` si lo consultado ya basta para este modo.
    """
    names = set(executed or ())

    if not names:
        return _GAP_NO_TOOLS

    if names & SEARCH_TOOLS and not names & DOCUMENT_TOOLS:
        return _GAP_SEARCH_WITHOUT_DOCUMENT

    if mode.id in _MODES_THAT_NEED_SCRIPTURE and not names & SCRIPTURE_TOOLS:
        return _GAP_NO_SCRIPTURE

    return None


def budget_exhausted(started_at: float, budget_s: float, now: float) -> bool:
    """¿Se agotó el presupuesto de tiempo de la investigación?"""
    if budget_s <= 0:
        return False
    return (now - started_at) >= budget_s


def tool_cache_key(name: str, args: Any) -> str:
    """
    Clave estable para cachear el resultado de una herramienta dentro de una
    misma petición. Evita re-scrapear el mismo documento cuando el modelo lo
    vuelve a pedir en una ronda posterior (cuesta ~20 s cada vez).
    """
    payload = args if isinstance(args, dict) else {}
    try:
        serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        serialized = repr(sorted(payload.items())) if payload else "{}"
    return f"{name}:{serialized}"
