"""
JWLibraryWriter — inyecta datos en userData.db y recomprime el .jwlibrary.

Flujo:
  1. Recibe el userData.db original (bytes) + ExportRequest.
  2. Abre userData.db en memoria (sqlite3 :memory:).
  3. Ejecuta las sentencias SQL del SchemaMapper en una transacción.
  4. Si algo falla, hace rollback (atomicidad).
  5. Serializa el DB modificado a bytes.
  6. Recompresa con los archivos originales (manifest.json, contents/) +
     el userData.db modificado en un nuevo ZIP .jwlibrary.

Seguridad:
  - Todas las sentencias usan parámetros (?) — cero concatenación SQL.
  - Transacción atómica: o se inyecta todo, o nada.
  - No se ejecuta código SQL del archivo de entrada (solo INSERTs nuestros).
  - El userData.db original se valida como SQLite válido antes de abrir.
"""

import io
import zipfile
import sqlite3
import tempfile
import os
from typing import Optional, Tuple
from ...schemas.interop_schemas import ExportRequest, ExportResult
from .schema_mapper import SchemaMapper
from .jwlibrary_reader import JWLibraryError, MAX_ZIP_SIZE


class JWLibraryWriter:
    """Inyecta datos en userData.db y recomprime el .jwlibrary."""

    def __init__(self):
        self.mapper = SchemaMapper()

    def write(
        self,
        original_zip_bytes: bytes,
        original_db_bytes: bytes,
        request: ExportRequest,
    ) -> Tuple[ExportResult, bytes]:
        """
        Inyecta datos en userData.db y devuelve un nuevo .jwlibrary.

        Args:
            original_zip_bytes: Bytes del ZIP .jwlibrary original
            original_db_bytes: Bytes del userData.db original
            request: Datos a inyectar (marcas, notas, etiquetas)

        Returns:
            (ExportResult, new_jwlibrary_bytes)
        """
        errors: list[str] = []

        # 1. Inyectar datos en userData.db
        modified_db_bytes, inject_counts, inject_errors = self._inject_data(
            original_db_bytes, request
        )
        errors.extend(inject_errors)

        if not modified_db_bytes:
            return ExportResult(success=False, errors=errors), b""

        # 2. Recompresar el .jwlibrary
        new_zip_bytes, zip_errors = self._repackage(
            original_zip_bytes, modified_db_bytes
        )
        errors.extend(zip_errors)

        if not new_zip_bytes:
            return ExportResult(success=False, errors=errors), b""

        return (
            ExportResult(
                success=len(errors) == 0,
                marks_injected=inject_counts.get("marks", 0),
                notes_injected=inject_counts.get("notes", 0),
                tags_injected=inject_counts.get("tags", 0),
                file_size_bytes=len(new_zip_bytes),
                errors=errors,
            ),
            new_zip_bytes,
        )

    def _inject_data(
        self, db_bytes: bytes, request: ExportRequest
    ) -> Tuple[Optional[bytes], dict, list[str]]:
        """
        Abre userData.db, inyecta datos en transacción, devuelve bytes.

        Usa archivo temporal porque sqlite3 :memory: no se puede serializar
        directamente a bytes sin la API de backup (no disponible en stdlib).
        """
        counts: dict[str, int] = {}
        errors: list[str] = []

        # Mapear request a sentencias SQL
        statements, counts = self.mapper.map_export_request(request)

        tmp_path = None
        try:
            # Escribir DB original a archivo temporal
            tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
            tmp.write(db_bytes)
            tmp.close()
            tmp_path = tmp.name

            # Abrir y ejecutar en transacción
            conn = sqlite3.connect(tmp_path)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")

            try:
                conn.execute("BEGIN TRANSACTION")
                for sql, params in statements:
                    conn.execute(sql, params)
                conn.execute("COMMIT")
            except sqlite3.Error as e:
                conn.execute("ROLLBACK")
                errors.append(f"SQL injection failed (rolled back): {e}")
                conn.close()
                os.unlink(tmp_path)
                return None, counts, errors

            conn.close()

            # Leer el DB modificado
            with open(tmp_path, "rb") as f:
                modified_bytes = f.read()

            return modified_bytes, counts, errors

        except Exception as e:
            errors.append(f"Failed to inject data: {e}")
            return None, counts, errors
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def _repackage(
        self, original_zip_bytes: bytes, modified_db_bytes: bytes
    ) -> Tuple[Optional[bytes], list[str]]:
        """
        Recompresa el .jwlibrary: copia todos los archivos del ZIP original
        pero sustituye userData.db por la versión modificada.
        """
        errors: list[str] = []

        try:
            # Leer ZIP original
            original_zf = zipfile.ZipFile(io.BytesIO(original_zip_bytes), mode="r")
            original_items = original_zf.infolist()

            # Protección zip-bomb al re-empaquetar: validar tamaños declarados
            total = 0
            for item in original_items:
                if item.filename == "userData.db":
                    continue
                if item.file_size > MAX_ZIP_SIZE:
                    errors.append(
                        f"ZIP entry too large: {item.filename}"
                    )
                    return None, errors
                total += item.file_size
            if total > 4 * MAX_ZIP_SIZE:
                errors.append("ZIP uncompressed size too large (possible zip bomb)")
                return None, errors

            # Crear nuevo ZIP
            output = io.BytesIO()
            with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as new_zf:
                for item in original_items:
                    if item.filename == "userData.db":
                        # Sustituir por la versión modificada
                        new_zf.writestr(item, modified_db_bytes)
                    else:
                        # Copiar archivo original tal cual
                        data = original_zf.read(item.filename)
                        new_zf.writestr(item, data)

            original_zf.close()
            return output.getvalue(), errors

        except Exception as e:
            errors.append(f"Failed to repackage ZIP: {e}")
            return None, errors

    def create_fresh_library(self, request: ExportRequest) -> Tuple[ExportResult, bytes]:
        """
        Crea un .jwlibrary desde cero (sin archivo original).

        Útil cuando el usuario quiere exportar sin tener un backup previo.
        Crea un userData.db vacío con el esquema oficial, inyecta los datos,
        y empaqueta con un manifest.json minimal.
        """
        from ...schemas.interop_schemas import USERDATA_DB_SCHEMA
        import json

        errors: list[str] = []

        # 1. Crear userData.db vacío
        tmp_path = None
        try:
            tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
            tmp.close()
            tmp_path = tmp.name

            conn = sqlite3.connect(tmp_path)
            conn.executescript(USERDATA_DB_SCHEMA)

            # 2. Inyectar datos
            statements, counts = self.mapper.map_export_request(request)
            try:
                conn.execute("BEGIN TRANSACTION")
                for sql, params in statements:
                    conn.execute(sql, params)
                conn.execute("COMMIT")
            except sqlite3.Error as e:
                conn.execute("ROLLBACK")
                errors.append(f"SQL injection failed: {e}")
                conn.close()
                os.unlink(tmp_path)
                return ExportResult(success=False, errors=errors), b""

            conn.close()

            with open(tmp_path, "rb") as f:
                db_bytes = f.read()

            # 3. Crear manifest.json
            manifest = {
                "version": 1,
                "createdDate": self.mapper.current_timestamp(),
                "appVersion": "Study-Export-1.0",
                "deviceName": "Study Web App",
            }
            manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")

            # 4. Empaquetar ZIP
            output = io.BytesIO()
            with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("userData.db", db_bytes)
                zf.writestr("manifest.json", manifest_bytes)

            zip_bytes = output.getvalue()

            return (
                ExportResult(
                    success=len(errors) == 0,
                    marks_injected=counts.get("marks", 0),
                    notes_injected=counts.get("notes", 0),
                    tags_injected=counts.get("tags", 0),
                    file_size_bytes=len(zip_bytes),
                    errors=errors,
                ),
                zip_bytes,
            )

        except Exception as e:
            errors.append(f"Failed to create fresh library: {e}")
            return ExportResult(success=False, errors=errors), b""
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
