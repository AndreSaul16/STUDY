"""
SchemaMapper — traduce las anotaciones de la app al esquema real de JW Library.

Trabaja SOBRE la base del usuario, no sobre una copia vacía: recibe una
conexión al userData.db de su backup y le añade lo nuevo. Así sus marcas
originales nunca se tocan ni se recodifican, que es lo que garantiza que no se
pierda nada al restaurar en el móvil.

Modelo relacional real (verificado contra un backup de schemaVersion 16):

    Location ──< UserMark ──< BlockRange
        └──────< Note >──── TagMap ──── Tag

Todo cuelga de `Location`. Una marca no apunta a un documento suelto: apunta a
un LocationId que identifica el capítulo bíblico o la publicación exacta. El
mapeador anterior insertaba en `UserMark(DocumentId, BlockIndex, Color)` y en
una tabla `NoteTag`; ninguna de esas columnas ni esa tabla existen.

Fusión por GUID
---------------
`UserMark.UserMarkGuid` y `Note.Guid` son UNIQUE en el esquema real, y se usan
como clave de fusión: reexportar algo que ya está lo ACTUALIZA en vez de
duplicarlo. Eso permite ir y volver entre móvil y ordenador cuantas veces haga
falta sin acumular copias.

Sobre los tokens
----------------
`BlockRange.StartToken`/`EndToken` son índices de la tokenización interna de
JW Library, que NO es partir por espacios (comprobado: un versículo con marca
hasta el token 36 tiene 32 palabras, 34 contando los marcadores). Aquí no se
inventan: se escribe lo que llegue en el DTO, y se admite NULL, que el esquema
permite. Mientras no se conozca esa tokenización, lo honesto es no fabricar
posiciones que caerían en palabras equivocadas.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ...schemas.interop_schemas import ExportRequest, LocationDTO, MarkExportDTO


def _now() -> str:
    """Timestamp con el formato exacto que usa JW Library."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class MergeCounts:
    """Qué se creó y qué se actualizó, para poder informar con precisión."""

    locations_created: int = 0
    marks_created: int = 0
    marks_updated: int = 0
    ranges_created: int = 0
    notes_created: int = 0
    notes_updated: int = 0
    tags_created: int = 0
    tag_links_created: int = 0
    skipped: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "locations_created": self.locations_created,
            "marks_created": self.marks_created,
            "marks_updated": self.marks_updated,
            "ranges_created": self.ranges_created,
            "notes_created": self.notes_created,
            "notes_updated": self.notes_updated,
            "tags_created": self.tags_created,
            "tag_links_created": self.tag_links_created,
            "skipped": self.skipped,
        }


class SchemaMapper:
    """Inyecta un ExportRequest en un userData.db real, fusionando por GUID."""

    def merge(self, conn: sqlite3.Connection, request: ExportRequest) -> MergeCounts:
        """
        Aplica el request sobre la conexión dada.

        La transacción es responsabilidad del llamador: aquí no se hace commit,
        para que un fallo a mitad revierta el conjunto y el backup del usuario
        quede intacto.
        """
        counts = MergeCounts()

        tag_ids = {
            tag.name: self._ensure_tag(conn, tag.name, tag.tag_type, counts)
            for tag in request.tags
        }

        note_ids: dict[int, int] = {}

        for index, mark in enumerate(request.marks):
            location_id = self._ensure_location(conn, mark.location, counts)
            if location_id is None:
                counts.skipped.append(
                    f"marca {mark.local_id}: localización insuficiente"
                )
                continue

            user_mark_id = self._upsert_user_mark(conn, mark, location_id, counts)
            self._replace_ranges(conn, user_mark_id, mark, counts)

            if mark.note is not None:
                note_ids[index] = self._upsert_note(
                    conn, mark, user_mark_id, location_id, counts
                )

        for link in request.note_tag_links:
            note_id = note_ids.get(link.note_mark_index)
            tag_id = tag_ids.get(link.tag_name)
            if note_id is None or tag_id is None:
                continue
            if self._link_tag(conn, tag_id, note_id):
                counts.tag_links_created += 1

        return counts

    # ─── Location ────────────────────────────────────────────────

    def _ensure_location(
        self, conn: sqlite3.Connection, loc: LocationDTO, counts: MergeCounts
    ) -> int | None:
        """
        Devuelve el LocationId, reutilizando la fila que ya exista.

        Reutilizar no es una optimización: si el usuario ya tenía marcas en
        Juan 3, las nuevas deben colgar de ESA fila. Además el esquema lo
        impone con dos restricciones UNIQUE.
        """
        es_biblia = loc.book_number is not None and loc.chapter_number is not None
        if not es_biblia and not loc.document_id:
            return None  # No cumpliría el CHECK de Type = 0.

        if es_biblia:
            key_symbol = loc.key_symbol or "nwtsty"
            row = conn.execute(
                "SELECT LocationId FROM Location "
                "WHERE BookNumber = ? AND ChapterNumber = ? AND KeySymbol = ? "
                "  AND IFNULL(MepsLanguage, -1) = ? AND Type = ?",
                (
                    loc.book_number,
                    loc.chapter_number,
                    key_symbol,
                    loc.meps_language,
                    loc.location_type,
                ),
            ).fetchone()
            if row:
                return row[0]

            cur = conn.execute(
                "INSERT INTO Location "
                "(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type, "
                " IssueTagNumber, Title) VALUES (?, ?, ?, ?, ?, 0, ?)",
                (
                    loc.book_number,
                    loc.chapter_number,
                    key_symbol,
                    loc.meps_language,
                    loc.location_type,
                    loc.title,
                ),
            )
        else:
            row = conn.execute(
                "SELECT LocationId FROM Location "
                "WHERE DocumentId = ? AND IFNULL(MepsLanguage, -1) = ? AND Type = ?",
                (loc.document_id, loc.meps_language, loc.location_type),
            ).fetchone()
            if row:
                return row[0]

            cur = conn.execute(
                "INSERT INTO Location "
                "(DocumentId, KeySymbol, IssueTagNumber, MepsLanguage, Type, Title) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    loc.document_id,
                    loc.key_symbol,
                    loc.issue_tag_number,
                    loc.meps_language,
                    loc.location_type,
                    loc.title,
                ),
            )

        counts.locations_created += 1
        return cur.lastrowid

    # ─── UserMark ────────────────────────────────────────────────

    def _upsert_user_mark(
        self,
        conn: sqlite3.Connection,
        mark: MarkExportDTO,
        location_id: int,
        counts: MergeCounts,
    ) -> int:
        """Crea la marca, o actualiza la que ya tenga ese GUID."""
        guid = mark.guid or str(uuid.uuid4())

        row = conn.execute(
            "SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?", (guid,)
        ).fetchone()

        if row:
            conn.execute(
                "UPDATE UserMark SET ColorIndex = ?, LocationId = ?, StyleIndex = ? "
                "WHERE UserMarkId = ?",
                (int(mark.color), location_id, mark.style, row[0]),
            )
            counts.marks_updated += 1
            return row[0]

        cur = conn.execute(
            "INSERT INTO UserMark "
            "(ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version) "
            "VALUES (?, ?, ?, ?, 1)",
            (int(mark.color), location_id, mark.style, guid),
        )
        counts.marks_created += 1
        return cur.lastrowid

    def _replace_ranges(
        self,
        conn: sqlite3.Connection,
        user_mark_id: int,
        mark: MarkExportDTO,
        counts: MergeCounts,
    ) -> None:
        """
        Reescribe los rangos de la marca.

        Se borran y reinsertan en lugar de casarlos uno a uno: los rangos no
        tienen identidad propia (no hay GUID), así que la unidad con sentido
        es la marca entera.
        """
        conn.execute("DELETE FROM BlockRange WHERE UserMarkId = ?", (user_mark_id,))

        for rng in mark.ranges:
            conn.execute(
                "INSERT INTO BlockRange "
                "(BlockType, Identifier, StartToken, EndToken, UserMarkId) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    rng.block_type,
                    rng.identifier,
                    rng.start_token,
                    rng.end_token,
                    user_mark_id,
                ),
            )
            counts.ranges_created += 1

    # ─── Note ────────────────────────────────────────────────────

    def _upsert_note(
        self,
        conn: sqlite3.Connection,
        mark: MarkExportDTO,
        user_mark_id: int,
        location_id: int,
        counts: MergeCounts,
    ) -> int:
        """Crea o actualiza la nota, identificada por su Guid."""
        note = mark.note
        assert note is not None

        guid = note.guid or str(uuid.uuid4())
        ahora = _now()

        # La nota se ancla al mismo bloque que el primer rango de la marca.
        primer_rango = mark.ranges[0] if mark.ranges else None
        block_type = primer_rango.block_type if primer_rango else 0
        block_identifier = primer_rango.identifier if primer_rango else None
        # CHECK del esquema real: BlockType 0 exige BlockIdentifier NULL.
        if block_type == 0:
            block_identifier = None

        row = conn.execute("SELECT NoteId FROM Note WHERE Guid = ?", (guid,)).fetchone()

        if row:
            conn.execute(
                "UPDATE Note SET UserMarkId = ?, LocationId = ?, Title = ?, "
                "Content = ?, LastModified = ?, BlockType = ?, BlockIdentifier = ? "
                "WHERE NoteId = ?",
                (
                    user_mark_id,
                    location_id,
                    note.title,
                    note.content,
                    note.last_modified or ahora,
                    block_type,
                    block_identifier,
                    row[0],
                ),
            )
            counts.notes_updated += 1
            return row[0]

        cur = conn.execute(
            "INSERT INTO Note "
            "(Guid, UserMarkId, LocationId, Title, Content, LastModified, Created, "
            " BlockType, BlockIdentifier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                guid,
                user_mark_id,
                location_id,
                note.title,
                note.content,
                note.last_modified or ahora,
                note.created or ahora,
                block_type,
                block_identifier,
            ),
        )
        counts.notes_created += 1
        return cur.lastrowid

    # ─── Tag / TagMap ────────────────────────────────────────────

    def _ensure_tag(
        self, conn: sqlite3.Connection, name: str, tag_type: int, counts: MergeCounts
    ) -> int:
        """Devuelve el TagId, reutilizando la etiqueta si ya existe."""
        row = conn.execute(
            "SELECT TagId FROM Tag WHERE Type = ? AND Name = ?", (tag_type, name)
        ).fetchone()
        if row:
            return row[0]

        cur = conn.execute(
            "INSERT INTO Tag (Type, Name) VALUES (?, ?)", (tag_type, name)
        )
        counts.tags_created += 1
        return cur.lastrowid

    def _link_tag(self, conn: sqlite3.Connection, tag_id: int, note_id: int) -> bool:
        """
        Enlaza nota y etiqueta en TagMap.

        TagMap impone UNIQUE(TagId, NoteId) y UNIQUE(TagId, Position), así que
        hay que comprobar si el enlace ya existe y calcular la siguiente
        posición libre dentro de esa etiqueta.
        """
        existe = conn.execute(
            "SELECT 1 FROM TagMap WHERE TagId = ? AND NoteId = ?", (tag_id, note_id)
        ).fetchone()
        if existe:
            return False

        siguiente = conn.execute(
            "SELECT IFNULL(MAX(Position), -1) + 1 FROM TagMap WHERE TagId = ?",
            (tag_id,),
        ).fetchone()[0]

        conn.execute(
            "INSERT INTO TagMap (TagId, NoteId, Position) VALUES (?, ?, ?)",
            (tag_id, note_id, siguiente),
        )
        return True
