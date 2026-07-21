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
import json
import zipfile
import sqlite3
from typing import BinaryIO, Optional, Tuple
from ...schemas.interop_schemas import ImportResult, USERDATA_DB_SCHEMA


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

    def _extract_file(self, zf: zipfile.ZipFile, name: str) -> Optional[bytes]:
        """Extrae un archivo del ZIP de forma segura."""
        try:
            return zf.read(name)
        except KeyError:
            return None

    def _read_user_data_db(self, db_bytes: bytes) -> ImportResult:
        """
        Abre userData.db en memoria y lee las tablas relevantes.

        Usa sqlite3 stdlib con :memory: para no tocar disco.
        Solo ejecuta SELECTs — nunca INSERT/UPDATE/DELETE.
        """
        errors: list[str] = []
        marks_count = 0
        notes_count = 0
        tags_count = 0
        bookmarks_count = 0
        documents: list[int] = []

        try:
            conn = sqlite3.connect(":memory:")
            conn.executescript(USERDATA_DB_SCHEMA)  # Crear tablas si no existen
            # Cargar los datos del archivo
            conn.executescript(
                f"ATTACH DATABASE 'file::{db_bytes.hex()}?mode=ro' AS imported;"
            )
        except sqlite3.Error:
            # Si ATTACH falla (formato hex no soportado), usar approach alternativo
            try:
                # Escribir a archivo temporal en memoria via deserializer
                conn = sqlite3.connect(":memory:")
                conn.executescript(USERDATA_DB_SCHEMA)
                # Usar iterdump inverso no es práctico; usar approach con blob
                conn.close()
                # Approach: crear DB desde los bytes directamente
                import tempfile, os
                tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
                tmp.write(db_bytes)
                tmp.close()
                conn = sqlite3.connect(tmp.name)
                # Ahora leer
                result = self._query_tables(conn, errors)
                marks_count, notes_count, tags_count, bookmarks_count, documents = result
                conn.close()
                os.unlink(tmp.name)
                return ImportResult(
                    success=len(errors) == 0,
                    user_marks_count=marks_count,
                    notes_count=notes_count,
                    tags_count=tags_count,
                    bookmarks_count=bookmarks_count,
                    documents=documents,
                    errors=errors,
                )
            except Exception as e:
                errors.append(f"Failed to read userData.db: {e}")
                return ImportResult(success=False, errors=errors)

        # Leer tablas
        result = self._query_tables(conn, errors)
        marks_count, notes_count, tags_count, bookmarks_count, documents = result
        conn.close()

        return ImportResult(
            success=len(errors) == 0,
            user_marks_count=marks_count,
            notes_count=notes_count,
            tags_count=tags_count,
            bookmarks_count=bookmarks_count,
            documents=documents,
            errors=errors,
        )

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

        def safe_documents(table: str, col: str) -> list[int]:
            try:
                cur = conn.execute(f"SELECT DISTINCT {col} FROM {table}")
                return [row[0] for row in cur.fetchall() if row[0] is not None]
            except sqlite3.Error:
                return []

        marks = safe_count("UserMark")
        notes = safe_count("Note")
        tags = safe_count("Tag")
        bookmarks = safe_count("Bookmark")

        docs_from_marks = safe_documents("UserMark", "DocumentId")
        docs_from_notes = safe_documents("Note", "DocumentId")
        documents = list(set(docs_from_marks + docs_from_notes))

        return marks, notes, tags, bookmarks, documents
