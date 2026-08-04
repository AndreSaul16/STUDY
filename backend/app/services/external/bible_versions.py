"""
Otras traducciones de la Biblia, para comparar con la Traducción del Nuevo Mundo.

**Para qué**: comparar versiones es una de las cosas más útiles que se pueden
hacer al preparar una parte. Una expresión que en una traducción suena opaca a
veces se entiende de golpe en otra, y ver tres versiones de un versículo dice
más sobre lo que significa que cualquier comentario.

**Qué se puede servir y qué no** (esto es lo que decide el módulo, y conviene
que quede escrito):

Las traducciones modernas más conocidas en español —Reina-Valera 1960, la Nueva
Versión Internacional, la Biblia de las Américas, la Biblia de Jerusalén— están
protegidas por derechos de autor de sus editoriales. No hay ninguna API abierta
que las sirva, y descargarlas y guardarlas en la caché de la app sería una
infracción, no un detalle burocrático. Así que **no están**, y no es un olvido.

Lo que sí se puede: las de dominio público. Son antiguas, pero para comparar
sirven perfectamente — de hecho la Reina-Valera 1909 es la base de la 1960, y
en la mayoría de versículos el texto es muy parecido.

**Por qué getbible.net y no otras fuentes** (verificado en vivo, no supuesto):

  * getbible v2 direcciona los libros por NÚMERO (1-66). Comprobado con
    Génesis, Salmos, Cantares, 1 Corintios y Apocalipsis: todos responden.
  * La alternativa que se evaluó (el CDN de wldeh) direcciona por slug de
    texto, y los slugs son inconsistentes: "salmos" y "apocalipsis" responden,
    pero "genesis" y "1-corintios" dan 404. Un tercio de los libros quedaría
    inaccesible. Descartada por eso, no por preferencia.
  * bible-api.com no tiene ninguna traducción en español.

El texto se cachea en ``content_cache`` con su propio ``kind`` para no
mezclarse con el recuento de la Traducción del Nuevo Mundo, que es lo que mide
la descarga sin conexión.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from ..jw import content_cache
from ..jw.book_numbers import book_display_name

logger = logging.getLogger(__name__)

_API_BASE = "https://api.getbible.net/v2"
_TIMEOUT_SECONDS = 20.0
_USER_AGENT = "StudyApp/1.0"

#: Tipo propio en la caché. NO se mezcla con ``kind="chapter"``, que es la
#: Traducción del Nuevo Mundo: ese recuento es el que enseña la barra de
#: "descargar la Biblia", y contar aquí capítulos de otras versiones haría que
#: dijera que hay 1.400 de 1.189.
_CACHE_KIND = "bible_version"

#: Último libro del canon.
_LAST_BOOK = 66
#: Primer libro de las Escrituras Griegas Cristianas (Mateo).
_FIRST_NT_BOOK = 40


class BibleVersionError(Exception):
    """No se pudo obtener el capítulo. No expone trazas internas."""


@dataclass(frozen=True)
class BibleVersion:
    """Una traducción disponible para comparar."""

    id: str
    """Id que usa la app. Coincide con el código de getbible."""
    label: str
    year: str
    license: str
    #: ``True`` si solo tiene las Escrituras Griegas Cristianas.
    new_testament_only: bool = False

    def covers(self, book_number: int) -> bool:
        if self.new_testament_only:
            return book_number >= _FIRST_NT_BOOK
        return 1 <= book_number <= _LAST_BOOK

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "anio": self.year,
            "licencia": self.license,
            "solo_nt": self.new_testament_only,
        }


#: Catálogo. Los tres códigos están comprobados contra la API en vivo.
#:
#: Se ordenan de más a menos útil para comparar: la 1909 es la más cercana al
#: castellano de hoy y la base de la 1960, así que es la primera que alguien
#: querrá ver al lado de la Traducción del Nuevo Mundo.
VERSIONS: tuple[BibleVersion, ...] = (
    BibleVersion(
        id="valera",
        label="Reina-Valera",
        year="1909",
        license="Dominio público",
    ),
    BibleVersion(
        id="sse",
        label="Sagradas Escrituras",
        year="1569",
        license="Dominio público",
    ),
    BibleVersion(
        id="rv1858",
        label="Reina-Valera (Escrituras Griegas)",
        year="1858",
        license="Dominio público",
        new_testament_only=True,
    ),
)

#: La Traducción del Nuevo Mundo NO está aquí: no viene de esta fuente, la
#: sirve ``references.reference_resolver`` desde wol.jw.org. Este id es el que
#: usa la interfaz para pedirla en una comparación.
NWT_ID = "nwt"


def get_version(version_id: Optional[str]) -> Optional[BibleVersion]:
    """``None`` si el id no existe. Quien llama decide si eso es un 404."""
    clean = (version_id or "").strip().lower()
    return next((v for v in VERSIONS if v.id == clean), None)


def catalog() -> List[dict]:
    """Catálogo para la interfaz, con la Traducción del Nuevo Mundo delante."""
    return [
        {
            "id": NWT_ID,
            "label": "Traducción del Nuevo Mundo",
            "anio": "2019",
            "licencia": "jw.org",
            "solo_nt": False,
            "principal": True,
        },
        *({**v.to_dict(), "principal": False} for v in VERSIONS),
    ]


@dataclass(frozen=True)
class VersionVerse:
    """Un versículo de una traducción."""

    verse: int
    text: str

    def to_dict(self) -> dict:
        return {"verso": self.verse, "texto": self.text}


@dataclass(frozen=True)
class VersionChapter:
    """Un capítulo completo en una traducción concreta."""

    version_id: str
    version_label: str
    book_number: int
    book_name: str
    chapter: int
    verses: List[VersionVerse]

    def to_dict(self) -> dict:
        return {
            "version": self.version_id,
            "version_label": self.version_label,
            "libro": self.book_name,
            "libro_numero": self.book_number,
            "capitulo": self.chapter,
            "versiculos": [v.to_dict() for v in self.verses],
        }


def _cache_key(version_id: str, book_number: int, chapter: int) -> str:
    return f"{version_id}:{book_number}:{chapter}"


def _parse_verses(payload: Any) -> List[VersionVerse]:
    """
    Normaliza la respuesta de getbible.

    Forma real (verificada): ``{"verses": [{"chapter","verse","name","text"}]}``
    con ``verse`` como CADENA, no como número.

    Deduplica por número de versículo quedándose con el primero. No es
    paranoia: una de las traducciones evaluadas devolvía el capítulo entero
    repetido dos veces (72 entradas para Juan 3, que tiene 36), y sin esto el
    lector mostraría el texto doblado.
    """
    crudos = payload.get("verses") if isinstance(payload, dict) else None
    if not isinstance(crudos, list):
        return []

    vistos: set[int] = set()
    verses: List[VersionVerse] = []
    for item in crudos:
        if not isinstance(item, dict):
            continue
        try:
            numero = int(str(item.get("verse", "")).strip())
        except (TypeError, ValueError):
            continue
        texto = " ".join(str(item.get("text") or "").split())
        if not texto or numero in vistos:
            continue
        vistos.add(numero)
        verses.append(VersionVerse(verse=numero, text=texto))

    verses.sort(key=lambda v: v.verse)
    return verses


def fetch_chapter(version_id: str, book_number: int, chapter: int) -> VersionChapter:
    """
    Un capítulo en la traducción pedida.

    Permanente en caché: un texto publicado en 1909 no va a cambiar.
    """
    version = get_version(version_id)
    if version is None:
        raise BibleVersionError(f"Traducción desconocida: {version_id}")
    if not 1 <= book_number <= _LAST_BOOK:
        raise BibleVersionError("Número de libro fuera del canon")
    if chapter < 1:
        raise BibleVersionError("Capítulo inválido")
    if not version.covers(book_number):
        raise BibleVersionError(
            f"{version.label} ({version.year}) solo incluye las Escrituras Griegas."
        )

    key = _cache_key(version.id, book_number, chapter)
    cacheado = content_cache.get(_CACHE_KIND, key)

    if cacheado is None:
        try:
            response = httpx.get(
                f"{_API_BASE}/{version.id}/{book_number}/{chapter}.json",
                timeout=_TIMEOUT_SECONDS,
                headers={"User-Agent": _USER_AGENT},
                follow_redirects=True,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # noqa: BLE001 — red, DNS, 4xx/5xx, JSON roto…
            logger.warning(
                "No se pudo obtener %s %s:%s — %s", version.id, book_number, chapter, exc
            )
            raise BibleVersionError("No se pudo obtener esa traducción") from exc

        verses = _parse_verses(payload)
        if not verses:
            raise BibleVersionError("Esa traducción no tiene ese capítulo")

        cacheado = {
            "book_name": str(payload.get("book_name") or book_display_name(book_number)),
            "verses": [v.to_dict() for v in verses],
        }
        content_cache.put(_CACHE_KIND, key, cacheado)

    return VersionChapter(
        version_id=version.id,
        version_label=f"{version.label} ({version.year})",
        book_number=book_number,
        book_name=cacheado["book_name"],
        chapter=chapter,
        verses=[
            VersionVerse(verse=int(v["verso"]), text=str(v["texto"]))
            for v in cacheado["verses"]
        ],
    )


def compare(
    book_number: int,
    chapter: int,
    verse: int,
    version_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    El mismo versículo en varias traducciones, para ponerlas en paralelo.

    Un fallo de una traducción NO tumba la comparación: se anota y se devuelven
    las demás. Ver dos versiones es mejor que ver un error, y la que falló
    puede ser precisamente la que hoy no está sirviendo.

    NO incluye la Traducción del Nuevo Mundo: esa la sirve
    ``references.reference_resolver`` y quien llama la añade por su cuenta. Este
    módulo no sabe nada de wol.jw.org y no debe empezar a saberlo.
    """
    pedidas = version_ids or [v.id for v in VERSIONS]

    filas: List[Dict[str, Any]] = []
    fallos: List[str] = []

    for version_id in pedidas:
        version = get_version(version_id)
        if version is None:
            continue
        if not version.covers(book_number):
            continue

        try:
            capitulo = fetch_chapter(version.id, book_number, chapter)
        except BibleVersionError:
            fallos.append(version.label)
            continue

        texto = next((v.text for v in capitulo.verses if v.verse == verse), "")
        if not texto:
            continue

        filas.append(
            {
                "version": version.id,
                "version_label": capitulo.version_label,
                "texto": texto,
            }
        )

    resultado: Dict[str, Any] = {
        "libro_numero": book_number,
        "capitulo": chapter,
        "verso": verse,
        "traducciones": filas,
    }
    if fallos:
        resultado["aviso"] = (
            "No se pudieron consultar: " + ", ".join(fallos) + "."
        )
    return resultado


__all__ = [
    "NWT_ID",
    "VERSIONS",
    "BibleVersion",
    "BibleVersionError",
    "VersionChapter",
    "VersionVerse",
    "catalog",
    "compare",
    "fetch_chapter",
    "get_version",
]
