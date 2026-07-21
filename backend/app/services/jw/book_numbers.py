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


def book_number(name: str) -> int | None:
    """Devuelve el número (1-66) del libro dado su nombre en español, o None."""
    if not name:
        return None
    return _NAME_TO_NUMBER.get(_normalize(name))


def book_display_name(number: int) -> str:
    """Nombre de presentación en español para un número de libro (1-66)."""
    return _NUMBER_TO_NAME.get(number, f"Libro {number}")
