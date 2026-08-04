"""
Fechas de publicación — de qué año es lo que acaba de encontrar el agente.

Por qué existe: la Biblioteca en Línea guarda ochenta años de publicaciones y
el buscador ordena por relevancia, no por fecha. Una búsqueda de "sangre" o de
"educación superior" devuelve con la misma prioridad un artículo de 1975 y uno
de 2024. El informe que salga de ahí puede citar como vigente algo que las
publicaciones posteriores ya matizaron. El agente necesita **ver el año** de
cada fuente para poder decidir, y el usuario necesita poder **acotar el rango**.

Aquí no hay red ni estado: solo el trabajo sucio de sacar un año de las cuatro
formas FIABLES en que jw.org y wol.jw.org lo dejan escrito.

  1. El símbolo de la publicación, con el año en dos cifras
     "w06" → 2006 · "g19" → 2019 · "w20.06" → 2020 · "mwb17" → 2017
  2. La cita legible de un resultado de búsqueda de WOL, que empieza por el
     símbolo y termina por el año
     "w06 1/12 págs. 25-29 - La Atalaya 2006"  →  2006
  3. El año-mes incrustado en la clave de un vídeo de JW Broadcasting
     "pub-jwbcov_201705_15_VIDEO" → 2017
  4. Una fecha ISO, que es lo que devuelve el mediator de vídeos
     "2018-03-26T17:15:20.035Z" → 2018

**Y solo esas cuatro.** Rastrear años en texto libre parecía gratis y no lo es:
el índice "Índice de las publicaciones Watch Tower 1986-2026" se fechaba en
2026 (es su rango de cobertura, no su fecha) y el vídeo "En 1914 el mundo
cambió de rumbo" se fechaba en 1914 (es su tema). Una fecha inventada es peor
que ninguna: convierte el aviso de obsolescencia en ruido y puede tirar del
filtro justo la fuente buena. Por eso el barrido de años sueltos vive solo en
``year_from_citation``, que se aplica a cadenas con formato conocido.

**Sin año no se descarta nada.** Perspicacia, los libros y buena parte del
material de estudio no llevan año en la cita, y un filtro que los tirara
dejaría fuera justo las obras de referencia. Lo que no se puede fechar pasa el
filtro y se marca como tal; decidir es cosa del agente, no del regex.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

#: Antes de esto no hay nada en la Biblioteca en Línea. Un "1492" suelto en el
#: cuerpo de un artículo histórico no es la fecha de la publicación.
_MIN_YEAR = 1870

#: A partir de cuántos años una publicación merece un aviso de "compruébalo".
#: No es una fecha de caducidad: es el umbral con el que el agente sabe que
#: tiene que buscar si hay algo más reciente sobre lo mismo.
_DEFAULT_STALE_AFTER = 25


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    """Basura en el entorno degrada al default, igual que en el resto del backend."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r no es un número. Usando %s.", name, raw, default)
        return default
    return max(minimum, min(value, maximum))


def stale_after_years() -> int:
    """Años a partir de los cuales se avisa de posible obsolescencia."""
    return _env_int("RESEARCH_STALE_AFTER_YEARS", _DEFAULT_STALE_AFTER, 3, 120)


def current_year() -> int:
    return date.today().year


# ─── Extracción ──────────────────────────────────────────────────

#: Año de cuatro cifras suelto ("… - La Atalaya 2006", "Anuario 1994").
_YEAR4_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")

#: Fecha ISO del mediator ("2018-03-26T17:15:20.035Z").
_ISO_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})-\d{2}-\d{2}")

#: Año-mes de las claves de JW Broadcasting ("pub-jwbcov_201705_15_VIDEO").
_YEARMONTH_RE = re.compile(r"_((?:1[89]|20)\d{2})(?:0[1-9]|1[0-2])_")

#: Símbolo de publicación con año en dos cifras: w06, g19, wp17, mwb24, w20.06,
#: km95, ws15. El sufijo opcional es el número de revista dentro del año.
_SYMBOL_RE = re.compile(r"^([a-z]{1,4})(\d{2})(?:[.\-]\d{1,2})?$", re.IGNORECASE)

#: Símbolos que NO llevan año aunque terminen en dos cifras. Son libros y obras
#: de referencia numeradas por tomo: "it-1" (Perspicacia, volumen 1), "nwt".
#: Sin esta lista, "it-1" se leería como el año 2001.
_YEARLESS_SYMBOLS = frozenset({"it", "nwt", "rbi", "bi", "si", "ip", "re", "dp"})


def _two_digit_year(raw: str, reference: int) -> Optional[int]:
    """
    Expande un año de dos cifras.

    Regla: si cabe en este siglo sin quedar en el futuro, es de este siglo; si
    no, del anterior. Con 2026 como referencia, "06" es 2006 y "95" es 1995.
    """
    try:
        value = int(raw)
    except ValueError:
        return None

    candidate = (reference // 100) * 100 + value
    if candidate > reference:
        candidate -= 100
    return candidate if candidate >= _MIN_YEAR else None


def year_from_symbol(symbol: Optional[str], reference: Optional[int] = None) -> Optional[int]:
    """Año que codifica un símbolo de publicación ("w06" → 2006), o ``None``."""
    clean = (symbol or "").strip().lower()
    if not clean:
        return None

    match = _SYMBOL_RE.match(clean)
    if match is None:
        return None
    if match.group(1) in _YEARLESS_SYMBOLS:
        return None

    return _two_digit_year(match.group(2), reference or current_year())


def year_from_lank(lank: Optional[str], reference: Optional[int] = None) -> Optional[int]:
    """
    Año que codifica la clave de un vídeo de JW Broadcasting.

    ``pub-jwbcov_201705_15_VIDEO`` → 2017. Solo acepta el bloque ``_AAAAMM_``
    completo: el mes hace de comprobación: sin él, cualquier número de cuatro
    cifras dentro de una clave pasaría por año.
    """
    text = (lank or "").strip()
    if not text:
        return None
    match = _YEARMONTH_RE.search(text)
    if match is None:
        return None
    year = int(match.group(1))
    return year if _MIN_YEAR <= year <= (reference or current_year()) + 1 else None


def year_from_iso(value: Optional[str]) -> Optional[int]:
    """Año de una fecha ISO ("2018-03-26T17:15:20.035Z" → 2018)."""
    match = _ISO_RE.search((value or "").strip())
    return int(match.group(1)) if match else None


def year_from_citation(
    citation: Optional[str], reference: Optional[int] = None
) -> Optional[int]:
    """
    Año de una cita de la Biblioteca en Línea.

    Formato real: ``"w06 1/12 págs. 25-29 - La Atalaya 2006"``. Se intenta
    primero por el símbolo de cabecera, que es inequívoco, y solo si falla se
    coge el último año de cuatro cifras — las citas de WOL terminan con el año
    de la publicación, así que "el último" es el bueno.

    Esta es la ÚNICA función que rastrea años en texto: se le pasan cadenas con
    formato conocido, nunca títulos ni descripciones.
    """
    text = " ".join((citation or "").split())
    if not text:
        return None

    ref = reference or current_year()

    por_simbolo = year_from_symbol(text.split()[0], ref)
    if por_simbolo is not None:
        return por_simbolo

    encontrados = _YEAR4_RE.findall(text)
    if encontrados:
        candidate = int(encontrados[-1])
        if _MIN_YEAR <= candidate <= ref + 1:
            return candidate

    return None


def parse_year(
    *candidates: Optional[str], reference: Optional[int] = None
) -> Optional[int]:
    """
    Primer año que se pueda sacar de los textos recibidos, en ese orden.

    Acepta SOLO señales estructuradas: fecha ISO, clave de vídeo con ``_AAAAMM_``
    y símbolo de publicación. Para citas de WOL usa ``year_from_citation``, que
    sí sabe leerlas. Un título nunca es una fecha.
    """
    ref = reference or current_year()

    for raw in candidates:
        text = (raw or "").strip()
        if not text:
            continue

        for extractor in (year_from_iso, lambda t: year_from_lank(t, ref)):
            year = extractor(text)
            if year is not None:
                return year

        # El símbolo puede venir solo ("w06") o como primera palabra
        # ("w06 1/12 págs. 25-29").
        from_symbol = year_from_symbol(text.split()[0], ref)
        if from_symbol is not None:
            return from_symbol

    return None


# ─── Filtro y etiquetado ─────────────────────────────────────────


def within_range(
    year: Optional[int], since: Optional[int] = None, until: Optional[int] = None
) -> bool:
    """
    ¿Entra este año en el rango pedido?

    ``None`` (no se pudo fechar) SIEMPRE entra. Ver la cabecera del módulo: un
    filtro que tirase lo no fechable dejaría fuera Perspicacia y los libros.
    """
    if year is None:
        return True
    if since is not None and year < since:
        return False
    if until is not None and year > until:
        return False
    return True


def is_stale(year: Optional[int], reference: Optional[int] = None) -> bool:
    """¿Es lo bastante antigua como para exigir comprobar si hay algo posterior?"""
    if year is None:
        return False
    return (reference or current_year()) - year >= stale_after_years()


def freshness_note(year: Optional[int], reference: Optional[int] = None) -> str:
    """
    Aviso corto para el agente, o cadena vacía si no hace falta ninguno.

    Va dentro del resultado de la herramienta, no en el prompt: así el aviso
    viaja pegado a la fuente concreta que lo merece en vez de ser una regla
    general que el modelo aplica a ojo.
    """
    if year is None:
        return (
            "Sin fecha en la cita. Comprueba en el propio artículo de qué "
            "publicación y año es antes de darlo por vigente."
        )
    if is_stale(year, reference):
        edad = (reference or current_year()) - year
        return (
            f"Publicación de hace {edad} años. Antes de citarla, busca si hay "
            "material más reciente sobre lo mismo; si lo hay, manda lo reciente."
        )
    return ""


def annotate(
    payload: dict,
    *candidates: Optional[str],
    reference: Optional[int] = None,
) -> dict:
    """
    Añade ``anio`` y, si procede, ``aviso_fecha`` a un resultado de búsqueda.

    Muta y devuelve el mismo dict: los llamadores lo construyen y lo anotan en
    la misma expresión.
    """
    year = parse_year(*candidates, reference=reference)
    payload["anio"] = year
    nota = freshness_note(year, reference)
    if nota:
        payload["aviso_fecha"] = nota
    return payload


def filter_by_years(
    items: Iterable[dict],
    since: Optional[int] = None,
    until: Optional[int] = None,
) -> list[dict]:
    """Deja fuera lo que se pueda fechar y caiga fuera del rango."""
    return [item for item in items if within_range(item.get("anio"), since, until)]


def clamp_year(value: object) -> Optional[int]:
    """
    Normaliza un año que viene del modelo o del cliente.

    Tolerante a propósito: el modelo manda a veces "2010" como cadena, o un año
    imposible. Nada de esto puede reventar la herramienta.
    """
    if value is None or value == "":
        return None
    try:
        year = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if year < _MIN_YEAR or year > current_year() + 1:
        return None
    return year


__all__ = [
    "annotate",
    "clamp_year",
    "current_year",
    "filter_by_years",
    "freshness_note",
    "is_stale",
    "parse_year",
    "stale_after_years",
    "within_range",
    "year_from_citation",
    "year_from_iso",
    "year_from_lank",
    "year_from_symbol",
]
