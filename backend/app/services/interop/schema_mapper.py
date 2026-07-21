"""
SchemaMapper — mapea nuestro modelo de datos al esquema de userData.db.

Transforma los DTOs del frontend (MarkExportDTO, NoteExportDTO, TagExportDTO)
en sentencias SQL listas para insertar en las tablas de la app oficial:
  - UserMark
  - BlockRange
  - Note
  - Tag
  - NoteTag

El mapeo es no destructivo: solo INSERT, nunca UPDATE/DELETE de datos
existentes. Esto preserva las notas/marcas que el usuario ya tenía.

Cálculo de tokens:
  La app oficial usa "tokens" como unidad de posición dentro de un bloque.
  Un token ≈ una palabra. Calculamos tokens dividiendo el texto por
  espacios en blanco. El StartToken y EndToken son índices absolutos
  dentro del bloque.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Tuple, Dict
from ...schemas.interop_schemas import (
    MarkExportDTO,
    NoteExportDTO,
    TagExportDTO,
    NoteTagLinkDTO,
    ExportRequest,
)


class SchemaMapper:
    """
    Mapea nuestros DTOs a sentencias SQL parametrizadas.

    Devuelve listas de (sql, params) tuplas para ejecución segura.
    NUNCA concatena strings en SQL — siempre usa parámetros (?) para
    prevenir inyección SQL.
    """

    def map_export_request(
        self, request: ExportRequest
    ) -> Tuple[List[Tuple[str, tuple]], Dict[str, int]]:
        """
        Convierte una ExportRequest en sentencias SQL listas para ejecutar.

        Returns:
            (statements, counts)
            — statements: lista de (sql, params) en orden de dependencia.
            — counts: {marks, notes, tags, ranges} para el ExportResult.
        """
        statements: list[tuple[str, tuple]] = []
        counts = {"marks": 0, "notes": 0, "tags": 0, "ranges": 0, "links": 0}

        # 1. Insertar Tags (deben existir antes que NoteTag)
        for tag in request.tags:
            # Usar INSERT OR IGNORE para no duplicar tags existentes
            sql = "INSERT OR IGNORE INTO Tag (Name, Color, Version) VALUES (?, ?, 0)"
            statements.append((sql, (tag.name, tag.color)))
            counts["tags"] += 1

        # 2. Insertar UserMarks + BlockRanges + Notes.
        #    Guardamos el GUID por índice de marca para resolver NoteTag después.
        mark_guids: Dict[int, str] = {}
        for index, mark in enumerate(request.marks):
            user_mark_guid = str(uuid.uuid4())
            mark_guids[index] = user_mark_guid
            block_range_count = len(mark.ranges)

            # UserMark
            sql_mark = (
                "INSERT INTO UserMark "
                "(DocumentId, BlockIndex, BlockRangeCount, Color, UserMarkGuid, "
                "Slot, Version, Insensitive) "
                "VALUES (?, ?, ?, ?, ?, 0, 0, 0)"
            )
            params_mark = (
                mark.document_id,
                mark.block_index,
                block_range_count,
                int(mark.color),
                user_mark_guid,
            )
            statements.append((sql_mark, params_mark))
            counts["marks"] += 1

            # BlockRanges — referencian el UserMark por GUID (no last_insert_rowid,
            # que se rompería al insertar el segundo rango).
            for rng in mark.ranges:
                sql_range = (
                    "INSERT INTO BlockRange "
                    "(UserMarkId, BlockIndex, StartToken, EndToken, TokenCount, Version) "
                    "VALUES ((SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?), "
                    "?, ?, ?, ?, 0)"
                )
                params_range = (
                    user_mark_guid,
                    mark.block_index,
                    rng.start_token,
                    rng.end_token,
                    rng.token_count,
                )
                statements.append((sql_range, params_range))
                counts["ranges"] += 1

            # Note vinculada (opcional) — referencia el UserMark por GUID.
            if mark.note:
                sql_note = (
                    "INSERT INTO Note "
                    "(UserMarkId, DocumentId, BlockRangeCount, Title, Content, LastModified, Version) "
                    "VALUES ((SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?), ?, ?, ?, ?, ?, 0)"
                )
                params_note = (
                    user_mark_guid,
                    mark.document_id,
                    block_range_count,
                    mark.note.title,
                    mark.note.content,
                    mark.note.last_modified,
                )
                statements.append((sql_note, params_note))
                counts["notes"] += 1

        # 3. Insertar NoteTag links. Cada link referencia la marca por índice.
        #    Usamos INSERT ... SELECT con JOINs: si la nota o la etiqueta no
        #    existen, el SELECT no devuelve filas y el link se salta sin error.
        for link in request.note_tag_links:
            mark_guid = mark_guids.get(link.note_mark_index)
            if not mark_guid or not link.tag_name:
                continue
            sql_link = (
                "INSERT INTO NoteTag (NoteId, TagId, Version) "
                "SELECT n.NoteId, t.TagId, 0 "
                "FROM Note n "
                "JOIN UserMark um ON um.UserMarkId = n.UserMarkId "
                "JOIN Tag t ON t.Name = ? "
                "WHERE um.UserMarkGuid = ?"
            )
            statements.append((sql_link, (link.tag_name, mark_guid)))
            counts["links"] += 1

        return statements, counts

    def current_timestamp(self) -> str:
        """Timestamp ISO 8601 para LastModified."""
        return datetime.now(timezone.utc).isoformat()
