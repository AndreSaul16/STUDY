"""
JWLibraryWriter — fusiona las anotaciones de la app en un .jwlibrary del usuario.

Parte SIEMPRE de un backup real del usuario y le añade lo nuevo. No genera
archivos desde cero a propósito: restaurar en JW Library REEMPLAZA todos los
datos del dispositivo, así que un archivo que no contenga lo que ya tenías
equivale a borrarlo. Partir de tu backup es lo que hace que el viaje
móvil → ordenador → móvil no pierda nada.

Empaquetar bien es tan importante como el SQL. Un .jwlibrary válido exige
cuatro cosas que antes no se hacían y que JW Library comprueba:

  1. `manifest.userDataBackup.hash` = SHA-256 del userData.db FINAL.
     Antes se copiaba el manifest original tal cual, así que el hash apuntaba
     a la base vieja y no cuadraba.
  2. La tabla `LastModified` DENTRO de la base debe coincidir con
     `manifest.userDataBackup.lastModifiedDate`.
  3. `schemaVersion` se lee del propio archivo (`PRAGMA user_version`), nunca
     se fija a mano: escribir uno más bajo degradaría un backup más nuevo.
  4. El ZIP NO debe llevar `userData.db-wal` ni `-shm`. Copiar un WAL viejo
     junto a una base modificada permite que SQLite lo reproduzca encima.

Los puntos 1-3 están verificados contra JWLManager (MIT, erykjj/jwlmanager),
cuya rutina de empaquetado sirvió de referencia; el punto 4 salió de inspeccionar
un backup real, que sí trae WAL.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from typing import Optional, Tuple

from ...schemas.interop_schemas import ExportRequest, ExportResult
from .schema_mapper import SchemaMapper, _now
from .jwlibrary_reader import MAX_ZIP_SIZE

DB_NAME = "userData.db"
# Archivos del ZIP original que NO se copian a la salida.
_EXCLUIR = {DB_NAME, f"{DB_NAME}-wal", f"{DB_NAME}-shm"}


class JWLibraryWriter:
    """Fusiona anotaciones en un .jwlibrary y lo vuelve a empaquetar."""

    def __init__(self) -> None:
        self.mapper = SchemaMapper()

    def write(
        self,
        original_zip_bytes: bytes,
        original_db_bytes: bytes,  # noqa: ARG002 — se lee del ZIP, se mantiene por compatibilidad
        request: ExportRequest,
    ) -> Tuple[ExportResult, bytes]:
        """
        Devuelve un .jwlibrary nuevo = el backup del usuario + lo de la app.

        Nunca modifica la entrada. Si algo falla, devuelve success=False con el
        motivo y cero bytes, en vez de un archivo a medias.
        """
        errors: list[str] = []
        workdir = tempfile.mkdtemp(prefix="jwl-")

        try:
            try:
                zf = zipfile.ZipFile(io.BytesIO(original_zip_bytes))
            except zipfile.BadZipFile:
                return ExportResult(success=False, errors=["El archivo no es un .jwlibrary válido"]), b""

            if DB_NAME not in zf.namelist():
                return ExportResult(success=False, errors=["El archivo no contiene userData.db"]), b""

            db_path = os.path.join(workdir, DB_NAME)
            with open(db_path, "wb") as f:
                f.write(zf.read(DB_NAME))

            # Consolidar el WAL dentro de la base antes de tocar nada: si no,
            # los cambios que viven en el journal se quedarían fuera.
            self._checkpoint_wal(zf, workdir, db_path)

            counts, merge_errors = self._merge(db_path, request)
            errors.extend(merge_errors)
            if counts is None:
                return ExportResult(success=False, errors=errors), b""

            manifest = self._build_manifest(zf, db_path)

            zip_bytes, zip_errors = self._repackage(zf, db_path, manifest)
            errors.extend(zip_errors)
            if zip_bytes is None:
                return ExportResult(success=False, errors=errors), b""

            return (
                ExportResult(
                    success=True,
                    marks_injected=counts.marks_created + counts.marks_updated,
                    notes_injected=counts.notes_created + counts.notes_updated,
                    tags_injected=counts.tags_created,
                    file_size_bytes=len(zip_bytes),
                    errors=errors + counts.skipped,
                ),
                zip_bytes,
            )

        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    # ─── Pasos ───────────────────────────────────────────────────

    def _checkpoint_wal(
        self, zf: zipfile.ZipFile, workdir: str, db_path: str
    ) -> None:
        """
        Vuelca el WAL del backup dentro del userData.db y lo descarta.

        Un .jwlibrary puede traer `userData.db-wal` con datos que aún no están
        en el archivo principal. Hay que escribirlo al lado, abrir la base para
        que SQLite lo reproduzca, y hacer TRUNCATE para dejarlo integrado.
        """
        nombres = zf.namelist()
        for sufijo in ("-wal", "-shm"):
            nombre = f"{DB_NAME}{sufijo}"
            if nombre in nombres:
                with open(os.path.join(workdir, nombre), "wb") as f:
                    f.write(zf.read(nombre))

        conn = sqlite3.connect(db_path)
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            # Pasar a journal DELETE para el resto del proceso: si siguiera en
            # WAL, las escrituras posteriores (la fusión y la tabla
            # LastModified) irían a un -wal que excluimos del ZIP, y el hash
            # se calcularía sobre una base a la que le faltan esos cambios.
            conn.execute("PRAGMA journal_mode = DELETE")
            conn.commit()
        finally:
            conn.close()

        # Ya integrados: fuera, para que no acaben en el ZIP de salida.
        for sufijo in ("-wal", "-shm"):
            ruta = os.path.join(workdir, f"{DB_NAME}{sufijo}")
            if os.path.exists(ruta):
                os.unlink(ruta)

    def _merge(self, db_path: str, request: ExportRequest):
        """Aplica el request en una única transacción."""
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("BEGIN")
            counts = self.mapper.merge(conn, request)
            conn.commit()
            return counts, []
        except sqlite3.Error as e:
            conn.rollback()
            return None, [f"No se pudo fusionar (revertido): {e}"]
        finally:
            conn.close()

    def _build_manifest(self, zf: zipfile.ZipFile, db_path: str) -> dict:
        """
        Construye el manifest de salida.

        Conserva el original como base para no perder campos que no
        conozcamos, y actualiza los que JW Library valida.
        """
        manifest: dict = {}
        if "manifest.json" in zf.namelist():
            try:
                manifest = json.loads(zf.read("manifest.json"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                manifest = {}

        ahora = _now()
        backup = dict(manifest.get("userDataBackup") or {})

        # La tabla LastModified de la base tiene que decir lo mismo que el
        # manifest, y schemaVersion sale del propio archivo.
        conn = sqlite3.connect(db_path)
        try:
            # UPDATE, no DELETE+INSERT: el esquema trae un trigger que prohíbe
            # borrar de LastModified ("DELETE FROM LastModified not allowed").
            # La tabla tiene una única fila que los triggers del propio esquema
            # van tocando en cada escritura; aquí solo la dejamos sincronizada
            # con la fecha que anunciamos en el manifest.
            conn.execute("UPDATE LastModified SET LastModified = ?", (ahora,))
            conn.commit()
            schema_version = conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()

        backup.update(
            {
                "lastModifiedDate": ahora,
                "databaseName": DB_NAME,
                "schemaVersion": schema_version,
                "deviceName": backup.get("deviceName") or "Study",
                # El hash se calcula al final: cualquier escritura previa en la
                # base (incluida la de LastModified) lo invalidaría.
                "hash": self._sha256(db_path),
            }
        )

        manifest.update(
            {
                "name": manifest.get("name") or "UserdataBackup_Study.jwlibrary",
                "creationDate": ahora[:10],
                "version": manifest.get("version", 1),
                "type": manifest.get("type", 0),
                "userDataBackup": backup,
            }
        )
        return manifest

    def _repackage(
        self, zf: zipfile.ZipFile, db_path: str, manifest: dict
    ) -> Tuple[Optional[bytes], list[str]]:
        """Reempaqueta: base fusionada + manifest nuevo + el resto del original."""
        errors: list[str] = []

        total = 0
        for item in zf.infolist():
            if item.filename in _EXCLUIR or item.filename == "manifest.json":
                continue
            if item.file_size > MAX_ZIP_SIZE:
                return None, [f"Entrada del ZIP demasiado grande: {item.filename}"]
            total += item.file_size
        if total > 4 * MAX_ZIP_SIZE:
            return None, ["Tamaño descomprimido excesivo (posible zip bomb)"]

        try:
            with open(db_path, "rb") as f:
                db_bytes = f.read()

            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as out:
                out.writestr(DB_NAME, db_bytes)
                out.writestr(
                    "manifest.json",
                    json.dumps(manifest, indent=None, separators=(",", ":")),
                )
                for item in zf.infolist():
                    if item.filename in _EXCLUIR or item.filename == "manifest.json":
                        continue
                    out.writestr(item, zf.read(item.filename))

            return output.getvalue(), errors
        except Exception as e:  # noqa: BLE001
            return None, [f"No se pudo empaquetar el archivo: {e}"]

    @staticmethod
    def _sha256(path: str) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
