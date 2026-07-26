"""
Tests del empaquetado de .jwlibrary.

Guardan las cuatro invariantes que JW Library comprueba al restaurar y que
antes no se cumplían — el export producía un archivo que la app habría
rechazado, informando de éxito:

  1. manifest.userDataBackup.hash == SHA-256 del userData.db que va dentro
  2. la tabla LastModified coincide con manifest.lastModifiedDate
  3. schemaVersion sale del archivo de origen (no se degrada)
  4. el ZIP no lleva userData.db-wal ni -shm

Y la garantía que le importa al usuario: **no se pierde nada**.
"""

import hashlib
import io
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import pytest

from app.schemas.interop_schemas import ExportRequest, USERDATA_DB_SCHEMA
from app.services.interop.jwlibrary_writer import JWLibraryWriter

JUAN_3 = {
    "book_number": 43,
    "chapter_number": 3,
    "key_symbol": "nwtsty",
    "meps_language": 1,
}


def _seed_db(path: Path, marcas_previas: int = 3) -> None:
    """Crea un userData.db con el esquema real y datos previos del usuario."""
    conn = sqlite3.connect(path)
    conn.executescript(USERDATA_DB_SCHEMA)
    conn.execute("DROP TRIGGER TR_Raise_Error_Before_Insert_LastModified")
    conn.execute("INSERT INTO LastModified (LastModified) VALUES ('2026-01-01T00:00:00Z')")
    conn.executescript(
        "CREATE TRIGGER TR_Raise_Error_Before_Insert_LastModified "
        "BEFORE INSERT ON LastModified BEGIN "
        "SELECT RAISE (FAIL, 'INSERT INTO LastModified not allowed'); END"
    )
    conn.execute("PRAGMA user_version = 16")
    conn.execute(
        "INSERT INTO Location (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, "
        "Type, IssueTagNumber) VALUES (19, 23, 'nwtsty', 1, 0, 0)"
    )
    for i in range(marcas_previas):
        conn.execute(
            "INSERT INTO UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid, "
            "Version) VALUES (1, 1, 0, ?, 1)",
            (f"previa-{i}",),
        )
    conn.commit()
    conn.close()


@pytest.fixture()
def backup(tmp_path) -> bytes:
    """Un .jwlibrary con la forma real, incluidos WAL y miniatura."""
    db_path = tmp_path / "userData.db"
    _seed_db(db_path)
    db_bytes = db_path.read_bytes()

    manifest = {
        "name": "UserdataBackup_2026-01-01_Movil.jwlibrary",
        "creationDate": "2026-01-01",
        "version": 1,
        "type": 0,
        "userDataBackup": {
            "lastModifiedDate": "2026-01-01T00:00:00Z",
            "deviceName": "Movil",
            "databaseName": "userData.db",
            "hash": hashlib.sha256(db_bytes).hexdigest(),
            "schemaVersion": 16,
        },
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("userData.db", db_bytes)
        z.writestr("userData.db-wal", b"")
        z.writestr("userData.db-shm", b"")
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("default_thumbnail.png", b"\x89PNG")
    return buf.getvalue()


def _request(contenido: str = "Nota del ordenador") -> ExportRequest:
    return ExportRequest.model_validate(
        {
            "marks": [
                {
                    "local_id": "m1",
                    "guid": "study-m1",
                    "location": JUAN_3,
                    "color": 3,
                    "ranges": [{"identifier": 16, "block_type": 2}],
                    "note": {"guid": "study-n1", "title": "Juan 3:16", "content": contenido},
                }
            ],
            "tags": [{"name": "Investigación", "tag_type": 1}],
            "note_tag_links": [{"note_mark_index": 0, "tag_name": "Investigación"}],
        }
    )


def _abrir(zip_bytes: bytes):
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    return z, z.read("userData.db"), json.loads(z.read("manifest.json"))


def _contar(db_bytes: bytes, tabla: str) -> int:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as t:
        t.write(db_bytes)
        ruta = t.name
    conn = sqlite3.connect(ruta)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0]
    finally:
        conn.close()
        Path(ruta).unlink()


class TestArchivoValido:
    def test_el_hash_del_manifest_corresponde_a_la_base_final(self, backup):
        _, db, manifest = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        assert manifest["userDataBackup"]["hash"] == hashlib.sha256(db).hexdigest()

    def test_no_se_incluye_el_wal(self, backup):
        z, _, _ = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        # Un WAL viejo junto a una base modificada puede reproducirse encima.
        assert "userData.db-wal" not in z.namelist()
        assert "userData.db-shm" not in z.namelist()

    def test_la_tabla_lastmodified_coincide_con_el_manifest(self, backup):
        _, db, manifest = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as t:
            t.write(db)
            ruta = t.name
        conn = sqlite3.connect(ruta)
        try:
            en_db = conn.execute("SELECT LastModified FROM LastModified").fetchone()[0]
        finally:
            conn.close()
            Path(ruta).unlink()

        assert en_db == manifest["userDataBackup"]["lastModifiedDate"]

    def test_conserva_la_version_de_esquema_del_origen(self, backup):
        _, _, manifest = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        # Escribir una versión más baja degradaría un backup más nuevo.
        assert manifest["userDataBackup"]["schemaVersion"] == 16

    def test_conserva_el_resto_de_archivos(self, backup):
        z, _, _ = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        assert "default_thumbnail.png" in z.namelist()


class TestNoSePierdeNada:
    def test_las_marcas_previas_siguen_ahi(self, backup):
        _, db, _ = _abrir(JWLibraryWriter().write(backup, b"", _request())[1])

        # 3 previas + 1 nueva
        assert _contar(db, "UserMark") == 4

    def test_reexportar_no_duplica(self, backup):
        writer = JWLibraryWriter()
        primera = writer.write(backup, b"", _request())[1]
        segunda = writer.write(primera, b"", _request("Editada"))[1]

        _, db, _ = _abrir(segunda)
        assert _contar(db, "UserMark") == 4
        assert _contar(db, "Note") == 1

    def test_el_hash_sigue_siendo_valido_tras_varias_pasadas(self, backup):
        writer = JWLibraryWriter()
        actual = backup
        for _ in range(3):
            actual = writer.write(actual, b"", _request())[1]

        _, db, manifest = _abrir(actual)
        assert manifest["userDataBackup"]["hash"] == hashlib.sha256(db).hexdigest()


class TestEntradasInvalidas:
    def test_un_archivo_que_no_es_zip_falla_limpiamente(self):
        result, out = JWLibraryWriter().write(b"esto no es un zip", b"", _request())

        assert result.success is False
        assert out == b""

    def test_un_zip_sin_userdata_falla_limpiamente(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("otra_cosa.txt", b"hola")

        result, out = JWLibraryWriter().write(buf.getvalue(), b"", _request())

        assert result.success is False
        assert out == b""
