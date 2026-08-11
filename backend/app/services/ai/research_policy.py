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

# Herramientas que devuelven el cuerpo de un documento (no un fragmento). La
# transcripción de un vídeo cuenta: es contenido completo y citable, igual que
# el texto de un artículo.
DOCUMENT_TOOLS = frozenset(
    {"abrir_documento", "abrir_video", "getWatchtowerContent", "getWorkbookContent"}
)

SEARCH_TOOLS = frozenset(
    {
        "buscar_en_biblioteca",
        "buscar_en_jw_org",
        "getWatchtowerLinks",
        "getWorkbookLinks",
        "search_bible_books",
    }
)

# Herramientas que traen material de FUERA de jw.org. Nunca bastan por sí
# solas: un informe sostenido solo en un paper no es lo que pide esta app.
EXTERNAL_TOOLS = frozenset({"buscar_en_internet"})

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

_GAP_ONLY_ONE_CATALOG = (
    "Has buscado solo en la Biblioteca en Línea y no has abierto nada. Te falta "
    "el otro catálogo: llama a buscar_en_jw_org, que indexa además los VÍDEOS "
    "de JW Broadcasting, y ábrelos con abrir_video para leer su transcripción. "
    "Si la Biblioteca no devolvió resultados, prueba también con menos palabras "
    "o con el tema en vez de con la cita."
)

_GAP_ONLY_EXTERNAL = (
    "Lo único que has consultado viene de fuera de jw.org. Eso no basta nunca: "
    "el dato externo sirve para ilustrar, no para enseñar. Busca en las "
    "publicaciones y en la Biblia antes de redactar."
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

    # Se comprueba antes que nada lo demás: con solo fuentes externas no hay
    # ni artículo que abrir ni pasaje que leer, así que las otras dos brechas
    # también saltarían, pero dirían algo menos útil que el motivo real.
    if names <= EXTERNAL_TOOLS:
        return _GAP_ONLY_EXTERNAL

    if names & SEARCH_TOOLS and not names & DOCUMENT_TOOLS:
        # Aquí se bifurca según SI SE MIRÓ EN LOS DOS CATÁLOGOS, y no es un
        # detalle: el caso real que se rompía era el agente buscando cuatro
        # veces en la Biblioteca, recibiendo cero cada vez y rindiéndose sin
        # haber tocado jw.org ni un vídeo. Decirle "abre el documento más
        # relevante" en esa situación es inútil —no había ninguno que abrir—,
        # así que se le manda al otro catálogo, que es donde puede haber algo.
        if "buscar_en_jw_org" not in names:
            return _GAP_ONLY_ONE_CATALOG
        return _GAP_SEARCH_WITHOUT_DOCUMENT

    if mode.id in _MODES_THAT_NEED_SCRIPTURE and not names & SCRIPTURE_TOOLS:
        return _GAP_NO_SCRIPTURE

    return None


def budget_exhausted(started_at: float, budget_s: float, now: float) -> bool:
    """¿Se agotó el presupuesto de tiempo de la investigación?"""
    if budget_s <= 0:
        return False
    return (now - started_at) >= budget_s


#: Aproximación de tokens a partir de caracteres, la misma heurística que usa
#: ``context_optimizer``. Se repite aquí a propósito en vez de importarla: aquel
#: módulo vive pegado a los esquemas del AIPanel y traerlo a la ruta del chat
#: metería media capa de schemas por cuatro caracteres de división.
_CHARS_PER_TOKEN = 4

#: Marca del recorte. El modelo tiene que SABER que ese resultado está cortado:
#: si no, cita párrafos y páginas como si tuviera el documento entero delante.
_TRIMMED_MARK = "\n…[resultado recortado para dejar sitio a la redacción]"


def research_tokens(messages: Iterable[Dict[str, Any]]) -> int:
    """
    Tokens aproximados que ocupa la investigación ya hecha en el historial.

    Solo cuentan los mensajes de rol ``tool``: son el material consultado, lo
    único que crece sin techo dentro de un turno (cada documento son hasta
    12 000 caracteres) y lo que decide cuánto va a pensar el modelo antes de
    escribir. El prompt del sistema y la conversación son constantes.
    """
    chars = 0
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "tool":
            continue
        content = message.get("content")
        if isinstance(content, str):
            chars += len(content)
    return chars // _CHARS_PER_TOKEN


def compact_tool_results(
    messages: Iterable[Dict[str, Any]], max_chars: int
) -> List[Dict[str, Any]]:
    """
    Copia del historial con los resultados de herramienta recortados.

    Sirve para la pasada de RESCATE de la redacción: cuando el modelo cerró el
    stream sin escribir, volver a pedírselo con el mismo material delante le
    hace pensar otra vez lo mismo y acabar igual. Darle menos que leer es lo
    único que cambia de verdad las condiciones.

    Se corta por la cabeza porque es donde están el título, la referencia y los
    primeros párrafos, que es lo que se cita. Los resultados pequeños (un
    versículo, un listado de búsqueda) pasan intactos: no son el problema.

    No modifica la lista original: la primera pasada tiene que poder usarla tal
    cual.
    """
    compactados: List[Dict[str, Any]] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "tool":
            compactados.append(message)
            continue
        content = message.get("content")
        if not isinstance(content, str) or len(content) <= max_chars:
            compactados.append(message)
            continue
        compactados.append({**message, "content": content[:max_chars] + _TRIMMED_MARK})
    return compactados


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
