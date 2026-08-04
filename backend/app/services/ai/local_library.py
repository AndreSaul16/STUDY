"""
Biblioteca local del usuario — fragmentos que aporta el CLIENTE.

POR QUÉ EXISTE ESTE MÓDULO

Las publicaciones .jwpub del usuario viven en IndexedDB de su navegador (ver
frontend/src/services/libraryCache.ts). Es una decisión deliberada: el backend
desencripta el .jwpub pero no es su almacén, para que la biblioteca sobreviva a
cualquier redespliegue. La consecuencia es que el agente, que corre aquí, NO
puede verlas.

El reparto es entonces: **recuperación en el cliente, generación en el
servidor**. El navegador busca los términos de la pregunta en los libros que el
usuario haya marcado y manda solo los fragmentos relevantes; aquí se convierten
en un mensaje de sistema. La publicación entera no se sube nunca.

EL CLIENTE NO ES DE FIAR

Todo lo que entra por aquí acaba dentro del prompt, así que se trata como
entrada hostil: se recorta en número y en longitud, se descartan los fragmentos
sin texto y se limpian los saltos de línea que podrían imitar la estructura de
un mensaje de sistema. Se TRUNCA en vez de rechazar (ver chat_schemas) porque un
cliente con topes distintos a los nuestros tiene que degradar, no recibir un 422
que le rompe el turno entero.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, List, Optional

#: Fragmentos que se aceptan por petición. Es el mismo tope que aplica el
#: cliente (LOCAL_SEARCH_LIMITS.maxSnippets); aquí se repite porque el cliente
#: puede ser otro, más viejo o directamente `curl`.
MAX_SNIPPETS = 6

#: Caracteres por fragmento. Con 700 caben unos dos párrafos, que es lo mínimo
#: para que un extracto se entienda sin su contexto.
MAX_SNIPPET_CHARS = 700

#: Longitudes de los metadatos. Van cortas a propósito: un "título" de 4 KB no
#: es un título, es alguien intentando meter instrucciones por la puerta de
#: atrás.
MAX_SYMBOL_CHARS = 32
MAX_TITLE_CHARS = 200


@dataclass(frozen=True)
class LocalSnippet:
    """Un fragmento de una publicación que el usuario tiene en su dispositivo."""

    symbol: str
    publication: str
    document_title: str
    text: str
    document_id: Optional[int] = None

    @property
    def label(self) -> str:
        """Cómo se nombra en las fuentes: el documento, o el libro si no hay."""
        return self.document_title or self.publication or self.symbol


def _clean(value: Any, limit: int) -> str:
    """
    Texto saneado y recortado.

    Los saltos de línea se colapsan en espacios: un fragmento con "\\n\\n## " y
    una instrucción detrás se leería como una sección nueva del prompt, y esto
    es contenido de usuario, no prompt.
    """
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def from_payload(payload: Any) -> List[LocalSnippet]:
    """
    Construye la lista desde lo que mandó el cliente.

    Tolerante igual que ``ResearchConfig.from_payload``: lo que no encaja se
    ignora en silencio. Un cliente antiguo no manda nada y recibe una lista
    vacía, que es exactamente el comportamiento de siempre.
    """
    if not isinstance(payload, list):
        return []

    snippets: List[LocalSnippet] = []
    for item in payload[:MAX_SNIPPETS]:
        data = item if isinstance(item, dict) else getattr(item, "__dict__", None)
        if not isinstance(data, dict):
            continue

        text = _clean(data.get("text"), MAX_SNIPPET_CHARS)
        if not text:
            # Un fragmento sin texto no aporta nada y sí gastaría una fuente en
            # la interfaz: se descarta entero.
            continue

        snippets.append(
            LocalSnippet(
                symbol=_clean(data.get("symbol"), MAX_SYMBOL_CHARS),
                publication=_clean(data.get("publication"), MAX_TITLE_CHARS),
                document_title=_clean(data.get("document_title"), MAX_TITLE_CHARS),
                text=text,
                document_id=_int_or_none(data.get("document_id")),
            )
        )

    return snippets


#: Cabecera del mensaje de sistema.
#:
#: Dice tres cosas y las tres importan: de dónde salen estos textos (del
#: dispositivo del usuario, con su permiso), que se citan como cualquier otra
#: publicación —son publicaciones de verdad, no notas sueltas— y que NO
#: autorizan a rellenar huecos. Sin la última, un fragmento a medias invita al
#: modelo a completar el razonamiento por su cuenta, que es justo lo que el
#: resto del prompt lleva veinte líneas prohibiendo.
_HEADER = """\
## PUBLICACIONES DEL USUARIO (consulta autorizada)

Lo que sigue son fragmentos de publicaciones que el usuario tiene guardadas EN
SU PROPIO DISPOSITIVO (archivos .jwpub) y ha autorizado expresamente a que
consultes en esta conversación. No los has buscado tú: te los ha traído él.

Cómo usarlos:
- Son publicaciones nuestras, así que valen como fuente de enseñanza y se citan
  igual que cualquier otra: título del artículo y publicación entre paréntesis,
  p. ej. "(Acerquémonos a Jehová, cap. 3)".
- Cita SOLO lo que aparezca literalmente en el fragmento. No completes el
  párrafo, no supongas qué decía antes o después y no inventes páginas.
- Un fragmento va cortado (lo marcan los "…"): si no contesta a la pregunta,
  dilo y busca en las herramientas. Estos textos NO te eximen de investigar.
- Si no vienen a cuento de lo que se pregunta, ignóralos sin mencionarlos.
"""


def build_context_message(snippets: Iterable[LocalSnippet]) -> Optional[str]:
    """
    El mensaje de sistema con los fragmentos, o ``None`` si no hay ninguno.

    Cada fragmento va etiquetado con su publicación y su símbolo para que el
    modelo pueda citarlo con precisión: sin el símbolo, dos libros con títulos
    parecidos se le mezclan y acaba atribuyendo una cita al que no es.
    """
    bloques: List[str] = []
    for index, snippet in enumerate(snippets, start=1):
        cabecera = snippet.publication or snippet.symbol or "Publicación del usuario"
        if snippet.symbol and snippet.publication:
            cabecera = f"{snippet.publication} ({snippet.symbol})"
        titulo = snippet.document_title or "Sin título"
        bloques.append(f"[{index}] {cabecera} — «{titulo}»\n{snippet.text}")

    if not bloques:
        return None
    return _HEADER + "\n" + "\n\n".join(bloques)


__all__ = [
    "MAX_SNIPPETS",
    "MAX_SNIPPET_CHARS",
    "LocalSnippet",
    "build_context_message",
    "from_payload",
]
