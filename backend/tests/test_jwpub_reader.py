"""Tests para JWPUBReader._read_sqlite (regresión C1: línea sqlite3.connect rota)."""
import io
import os
import sqlite3
import tempfile

from app.services.jwpub.jwpub_reader import JWPUBReader


def _make_db_bytes() -> bytes:
    """Crea un SQLite mínimo con tablas Document y PublicationViewItem."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    try:
        conn = sqlite3.connect(tmp.name)
        conn.execute(
            "CREATE TABLE Document (DocumentId INTEGER, Title TEXT, "
            "Content BLOB, ContentLength INTEGER)"
        )
        # Content NULL -> no intenta desencriptar
        conn.execute(
            "INSERT INTO Document VALUES (0, 'Capítulo 1', NULL, 0)"
        )
        conn.execute(
            "CREATE TABLE PublicationViewItem (Id INTEGER, "
            "ParentPublicationViewItemId INTEGER, Title TEXT, DocumentId INTEGER)"
        )
        conn.execute(
            "INSERT INTO PublicationViewItem VALUES (1, -1, 'Intro', 0)"
        )
        conn.commit()
        conn.close()
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)


def test_read_sqlite_from_bytes():
    reader = JWPUBReader()
    db_bytes = _make_db_bytes()
    # key/iv arbitrarios; Content es NULL, no se usan
    documents, toc = reader._read_sqlite(db_bytes, b"0" * 16, b"0" * 16)

    assert len(documents) == 1
    assert documents[0]["DocumentId"] == 0
    assert documents[0]["Title"] == "Capítulo 1"
    assert len(toc) == 1
    assert toc[0]["Title"] == "Intro"
    assert toc[0]["ParentId"] == -1
