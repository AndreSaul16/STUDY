"""
Mapa LOCAL nombre de libro bíblico (español) → número estándar (1-66).

El parser del frontend emite identificadores tipo ``scripture:{libro}:{cap}:{v}``
donde ``{libro}`` es el nombre canónico en español en minúsculas
(ej. ``efesios``, ``2 corintios``, ``salmo``). El MCP, en cambio, trabaja con
el número estándar de libro (1-66; Efesios = 49). Este módulo hace de puente
SIN depender del MCP inglés (que no entiende español).

La búsqueda es tolerante: normaliza el nombre (minúsculas, sin acentos, espacios
colapsados) para aceptar variantes con o sin tilde y "Salmo"/"Salmos".
"""

from __future__ import annotations

import unicodedata

# Orden estándar de los 66 libros → nombre de presentación en español.
_NUMBER_TO_NAME: dict[int, str] = {
    1: "Génesis", 2: "Éxodo", 3: "Levítico", 4: "Números", 5: "Deuteronomio",
    6: "Josué", 7: "Jueces", 8: "Rut", 9: "1 Samuel", 10: "2 Samuel",
    11: "1 Reyes", 12: "2 Reyes", 13: "1 Crónicas", 14: "2 Crónicas",
    15: "Esdras", 16: "Nehemías", 17: "Ester", 18: "Job", 19: "Salmos",
    20: "Proverbios", 21: "Eclesiastés", 22: "Cantares", 23: "Isaías",
    24: "Jeremías", 25: "Lamentaciones", 26: "Ezequiel", 27: "Daniel",
    28: "Oseas", 29: "Joel", 30: "Amós", 31: "Abdías", 32: "Jonás",
    33: "Miqueas", 34: "Nahúm", 35: "Habacuc", 36: "Sofonías", 37: "Ageo",
    38: "Zacarías", 39: "Malaquías", 40: "Mateo", 41: "Marcos", 42: "Lucas",
    43: "Juan", 44: "Hechos", 45: "Romanos", 46: "1 Corintios",
    47: "2 Corintios", 48: "Gálatas", 49: "Efesios", 50: "Filipenses",
    51: "Colosenses", 52: "1 Tesalonicenses", 53: "2 Tesalonicenses",
    54: "1 Timoteo", 55: "2 Timoteo", 56: "Tito", 57: "Filemón",
    58: "Hebreos", 59: "Santiago", 60: "1 Pedro", 61: "2 Pedro",
    62: "1 Juan", 63: "2 Juan", 64: "3 Juan", 65: "Judas", 66: "Apocalipsis",
}


def _normalize(name: str) -> str:
    """Minúsculas, sin acentos, espacios colapsados."""
    text = unicodedata.normalize("NFKD", name.strip().lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.split())


# Índice normalizado nombre → número (incluye variantes de tilde y "salmos").
_NAME_TO_NUMBER: dict[str, int] = {}
for _num, _display in _NUMBER_TO_NAME.items():
    _NAME_TO_NUMBER[_normalize(_display)] = _num

# Alias / variantes frecuentes que emite el parser o el usuario.
_ALIASES: dict[str, int] = {
    "salmo": 19,        # el parser normaliza "Salmos" → "Salmo"
    "cantar de los cantares": 22,
    "cantar": 22,
    "canticos": 22,
    "cantico de los canticos": 22,
    "judas": 65,
}
for _alias, _num in _ALIASES.items():
    _NAME_TO_NUMBER[_normalize(_alias)] = _num


# Número de capítulos por libro (índice = número de libro). Constante del
# canon, así que vive aquí en vez de costar una petición a WOL: el navegador
# de la Biblia necesita pintar la rejilla de capítulos al instante.
_CHAPTER_COUNTS: dict[int, int] = {
    1: 50, 2: 40, 3: 27, 4: 36, 5: 34, 6: 24, 7: 21, 8: 4, 9: 31, 10: 24,
    11: 22, 12: 25, 13: 29, 14: 36, 15: 10, 16: 13, 17: 10, 18: 42, 19: 150,
    20: 31, 21: 12, 22: 8, 23: 66, 24: 52, 25: 5, 26: 48, 27: 12, 28: 14,
    29: 3, 30: 9, 31: 1, 32: 4, 33: 7, 34: 3, 35: 3, 36: 3, 37: 2, 38: 14,
    39: 4, 40: 28, 41: 16, 42: 24, 43: 21, 44: 28, 45: 16, 46: 16, 47: 13,
    48: 6, 49: 6, 50: 4, 51: 4, 52: 5, 53: 3, 54: 6, 55: 4, 56: 3, 57: 1,
    58: 13, 59: 5, 60: 5, 61: 3, 62: 5, 63: 1, 64: 1, 65: 1, 66: 22,
}

# Los 39 primeros libros son las Escrituras Hebreas; el resto, las Griegas.
_HEBREW_SCRIPTURES_LAST = 39


def book_number(name: str) -> int | None:
    """Devuelve el número (1-66) del libro dado su nombre en español, o None."""
    if not name:
        return None
    return _NAME_TO_NUMBER.get(_normalize(name))


def book_display_name(number: int) -> str:
    """Nombre de presentación en español para un número de libro (1-66)."""
    return _NUMBER_TO_NAME.get(number, f"Libro {number}")


def chapter_count(number: int) -> int:
    """Número de capítulos del libro (0 si el número no es válido)."""
    return _CHAPTER_COUNTS.get(number, 0)


def all_books() -> list[dict]:
    """
    Catálogo completo de los 66 libros para el navegador de la Biblia.

    Cada entrada: número, nombre, capítulos y sección ("hebreas"/"griegas").
    """
    return [
        {
            "number": number,
            "name": name,
            "chapters": _CHAPTER_COUNTS.get(number, 0),
            "section": (
                "hebreas" if number <= _HEBREW_SCRIPTURES_LAST else "griegas"
            ),
        }
        for number, name in sorted(_NUMBER_TO_NAME.items())
    ]
