"""
JWLibraryReader — descomprime un archivo .jwlibrary y lee userData.db.

Un archivo .jwlibrary es internamente un ZIP que contiene:
  - userData.db        (SQLite con notas/marcas del usuario)
  - manifest.json      (metadatos del backup: versión, fecha, dispositivo)
  - contents/          (recursos multimedia opcionales)

Este módulo:
  1. Descomprime el ZIP en memoria.
  2. Verifica que userData.db existe y es un SQLite válido.
  3. Lee las tablas UserMark, BlockRange, Note, Tag, NoteTag, Bookmark.
  4. Devuelve un ImportResult con los datos encontrados.

Seguridad:
  - No ejecuta código SQL del archivo (solo SELECT).
  - Valida que el ZIP no contenga path traversal (../../../etc/passwd).
  - Límite de tamaño del ZIP (100MB) para evitar zip bombs.
"""

import io
import os
import json
import tempfile
import zipfile
import sqlite3
from typing import BinaryIO, Optional, Tuple
from ...schemas.interop_schemas import (
    ImportedMarkDTO,
    ImportedNoteDTO,
    ImportResult,
    LibraryEntryDTO,
)


MAX_ZIP_SIZE = 100 * 1024 * 1024  # 100 MB
USERDATA_DB_NAME = "userData.db"
MANIFEST_NAME = "manifest.json"


class JWLibraryError(Exception):
    """Error base para problemas de interoperabilidad."""
    pass


class JWLibraryReader:
    """Lee archivos .jwlibrary y extrae datos de userData.db."""

    def read(self, file_data: bytes) -> Tuple[ImportResult, Optional[bytes], Optional[dict]]:
        """
        Descomprime y lee un .jwlibrary.

        Args:
            file_data: Bytes del archivo .jwlibrary

        Returns:
            (ImportResult, userData_db_bytes, manifest_dict)
            — userData_db_bytes es el contenido del SQLite para reempaquetar.
            — manifest_dict son los metadatos del backup.
        """
        if len(file_data) > MAX_ZIP_SIZE:
            raise JWLibraryError(
                f"File too large: {len(file_data)} bytes (max {MAX_ZIP_SIZE})"
            )

        # 1. Descomprimir ZIP en memoria
        try:
            zf = zipfile.ZipFile(io.BytesIO(file_data), mode="r")
        except zipfile.BadZipFile as e:
            raise JWLibraryError(f"Invalid ZIP file: {e}") from e

        # 2. Validar nombres de archivos (path traversal protection)
        self._validate_zip_paths(zf)

        # 2b. Protección zip-bomb: validar tamaño descomprimido declarado
        self._check_zip_bomb(zf)

        # 3. Extraer userData.db
        db_bytes = self._extract_file(zf, USERDATA_DB_NAME)
        if db_bytes is None:
            raise JWLibraryError(
                f"{USERDATA_DB_NAME} not found in .jwlibrary archive"
            )

        # 4. Extraer manifest.json (opcional)
        manifest = None
        manifest_bytes = self._extract_file(zf, MANIFEST_NAME)
        if manifest_bytes:
            try:
                manifest = json.loads(manifest_bytes.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass  # Manifest corrupto — no es fatal

        # 5. Leer userData.db
        result = self._read_user_data_db(db_bytes)

        return result, db_bytes, manifest

    def _validate_zip_paths(self, zf: zipfile.ZipFile) -> None:
        """Valida que no haya path traversal en los nombres del ZIP."""
        for info in zf.infolist():
            name = info.filename
            # Path traversal: ../ o rutas absolutas
            if name.startswith("/") or ".." in name.split("/"):
                raise JWLibraryError(f"Unsafe path in ZIP: {name}")

    def _check_zip_bomb(self, zf: zipfile.ZipFile) -> None:
        """Rechaza ZIPs cuyo tamaño descomprimido declarado es excesivo."""
        total = 0
        for info in zf.infolist():
            if info.file_size > MAX_ZIP_SIZE:
                raise JWLibraryError(
                    f"ZIP entry too large: {info.filename} "
                    f"({info.file_size} bytes)"
                )
            total += info.file_size
        if total > 4 * MAX_ZIP_SIZE:
            raise JWLibraryError(
                "ZIP uncompressed size too large (possible zip bomb)"
            )

    def _extract_file(self, zf: zipfile.ZipFile, name: str) -> Optional[bytes]:
        """Extrae un archivo del ZIP de forma segura."""
        try:
            return zf.read(name)
        except KeyError:
            return None

    def _read_user_data_db(self, db_bytes: bytes) -> ImportResult:
        """
        Abre userData.db desde un archivo temporal y lee las tablas relevantes.

        sqlite3 stdlib no acepta bytes directamente, así que escribimos a un
        archivo temporal que se borra siempre en el finally.
        Solo ejecuta SELECTs — nunca INSERT/UPDATE/DELETE.
        """
        errors: list[str] = []

        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        try:
            tmp.write(db_bytes)
            tmp.close()

            conn = sqlite3.connect(tmp.name)
            conn.row_factory = sqlite3.Row
            try:
                marks, notes, tags, bookmarks, _ = self._query_tables(conn, errors)
                library = self._read_library(conn, errors)
                imported_marks = self._read_marks(conn, errors)
                imported_notes = self._read_notes(conn, errors)
            finally:
                conn.close()

            return ImportResult(
                success=len(errors) == 0,
                user_marks_count=marks,
                notes_count=notes,
                tags_count=tags,
                bookmarks_count=bookmarks,
                library=library,
                marks=imported_marks,
                notes=imported_notes,
                errors=errors,
            )
        except Exception as e:
            errors.append(f"Failed to read userData.db: {e}")
            return ImportResult(success=False, errors=errors)
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    def _query_tables(
        self, conn: sqlite3.Connection, errors: list[str]
    ) -> Tuple[int, int, int, int, list[int]]:
        """Ejecuta SELECTs seguros sobre las tablas conocidas."""
        marks = 0
        notes = 0
        tags = 0
        bookmarks = 0
        documents: list[int] = []

        def safe_count(table: str) -> int:
            try:
                cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
                return cur.fetchone()[0] or 0
            except sqlite3.Error as e:
                errors.append(f"Cannot read {table}: {e}")
                return 0

        marks = safe_count("UserMark")
        notes = safe_count("Note")
        tags = safe_count("Tag")
        bookmarks = safe_count("Bookmark")

        # Antes aquí se consultaba `UserMark.DocumentId` y `Note.DocumentId`.
        # Esas columnas no existen —las marcas cuelgan de LocationId— y el
        # error se tragaba en silencio, así que la lista salía siempre vacía.
        # Los documentos reales los resuelve ahora `_read_library` desde
        # `Location`, que es donde viven de verdad.
        return marks, notes, tags, bookmarks, documents

    # ─── Lectura del contenido real ──────────────────────────────

    def _read_library(
        self, conn: sqlite3.Connection, errors: list[str]
    ) -> list[LibraryEntryDTO]:
        """
        Índice de todo lo que el usuario ha estudiado, desde `Location`.

        Es lo que convierte un backup en una biblioteca navegable: cada fila
        dice dónde hay trabajo hecho, y el contenido se trae luego de WOL.
        Se ordena por cantidad de anotaciones, que es un buen proxy de
        "esto me importa".
        """
        try:
            filas = conn.execute(
                """
                SELECT l.LocationId, l.BookNumber, l.ChapterNumber, l.DocumentId,
                       l.KeySymbol, l.IssueTagNumber, l.MepsLanguage, l.Title,
                       (SELECT COUNT(*) FROM UserMark um WHERE um.LocationId = l.LocationId) AS marcas,
                       (SELECT COUNT(*) FROM Note n WHERE n.LocationId = l.LocationId) AS notas
                FROM Location l
                WHERE l.BookNumber IS NOT NULL OR l.DocumentId IS NOT NULL
                ORDER BY marcas + notas DESC, l.Title
                """
            ).fetchall()
        except sqlite3.Error as e:
            errors.append(f"No se pudo leer la biblioteca: {e}")
            return []

        entradas: list[LibraryEntryDTO] = []
        for f in filas:
            # Sin anotaciones no aporta nada al índice: sería ruido.
            if not f["marcas"] and not f["notas"]:
                continue
            es_biblia = f["BookNumber"] is not None
            entradas.append(
                LibraryEntryDTO(
                    location_id=f["LocationId"],
                    kind="bible" if es_biblia else "publication",
                    title=f["Title"],
                    book_number=f["BookNumber"],
                    chapter_number=f["ChapterNumber"],
                    document_id=f["DocumentId"],
                    key_symbol=f["KeySymbol"],
                    issue_tag_number=f["IssueTagNumber"] or 0,
                    meps_language=f["MepsLanguage"],
                    mark_count=f["marcas"],
                    note_count=f["notas"],
                )
            )
        return entradas

    def _read_marks(
        self, conn: sqlite3.Connection, errors: list[str]
    ) -> list[ImportedMarkDTO]:
        """
        Los subrayados con su rango.

        Una marca puede tener varios rangos; aquí se emite uno por rango,
        que es la unidad que el lector necesita para pintar.
        """
        try:
            filas = conn.execute(
                """
                SELECT um.UserMarkGuid, um.LocationId, um.ColorIndex, um.StyleIndex,
                       br.BlockType, br.Identifier, br.StartToken, br.EndToken
                FROM UserMark um
                LEFT JOIN BlockRange br ON br.UserMarkId = um.UserMarkId
                """
            ).fetchall()
        except sqlite3.Error as e:
            errors.append(f"No se pudieron leer los subrayados: {e}")
            return []

        return [
            ImportedMarkDTO(
                guid=f["UserMarkGuid"],
                location_id=f["LocationId"],
                color_index=f["ColorIndex"],
                style_index=f["StyleIndex"] or 0,
                block_type=f["BlockType"],
                identifier=f["Identifier"],
                start_token=f["StartToken"],
                end_token=f["EndToken"],
            )
            for f in filas
        ]

    def _read_notes(
        self, conn: sqlite3.Connection, errors: list[str]
    ) -> list[ImportedNoteDTO]:
        """Las notas, con las etiquetas que tengan puestas (vía TagMap)."""
        try:
            filas = conn.execute(
                """
                SELECT n.Guid, n.LocationId, n.Title, n.Content, n.LastModified,
                       n.BlockType, n.BlockIdentifier,
                       (SELECT GROUP_CONCAT(t.Name, CHAR(31))
                          FROM TagMap tm JOIN Tag t ON t.TagId = tm.TagId
                         WHERE tm.NoteId = n.NoteId) AS etiquetas
                FROM Note n
                ORDER BY n.LastModified DESC
                """
            ).fetchall()
        except sqlite3.Error as e:
            errors.append(f"No se pudieron leer las notas: {e}")
            return []

        return [
            ImportedNoteDTO(
                guid=f["Guid"],
                location_id=f["LocationId"],
                title=f["Title"] or "",
                content=f["Content"] or "",
                last_modified=f["LastModified"],
                block_type=f["BlockType"],
                block_identifier=f["BlockIdentifier"],
                # CHAR(31) como separador: es un carácter de control que no
                # puede aparecer en el nombre de una etiqueta.
                tags=f["etiquetas"].split(chr(31)) if f["etiquetas"] else [],
            )
            for f in filas
        ]
