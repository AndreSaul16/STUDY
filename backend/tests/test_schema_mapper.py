"""Tests para SchemaMapper (A4 BlockRange por GUID, M10 links por índice, B5 counts)."""
import sqlite3

from app.services.interop.schema_mapper import SchemaMapper
from app.schemas.interop_schemas import (
    ExportRequest,
    MarkExportDTO,
    RangeExportDTO,
    NoteExportDTO,
    TagExportDTO,
    NoteTagLinkDTO,
    JWMarkColor,
)
from app.schemas.interop_schemas import USERDATA_DB_SCHEMA


def _run(request: ExportRequest):
    mapper = SchemaMapper()
    statements, counts = mapper.map_export_request(request)
    conn = sqlite3.connect(":memory:")
    conn.executescript(USERDATA_DB_SCHEMA)
    conn.execute("BEGIN")
    for sql, params in statements:
        conn.execute(sql, params)
    conn.execute("COMMIT")
    return conn, counts


def test_two_block_ranges_same_usermark():
    request = ExportRequest(
        marks=[
            MarkExportDTO(
                local_id="m1",
                document_id=10,
                block_index=3,
                color=JWMarkColor.YELLOW,
                ranges=[
                    RangeExportDTO(start_token=0, end_token=2, token_count=2),
                    RangeExportDTO(start_token=5, end_token=8, token_count=3),
                ],
                note=NoteExportDTO(
                    title="t", content="c", last_modified="2024-01-01T00:00:00Z"
                ),
            )
        ],
        tags=[TagExportDTO(name="importante", color=0)],
        note_tag_links=[NoteTagLinkDTO(note_mark_index=0, tag_name="importante")],
    )
    conn, counts = _run(request)

    # Ambos BlockRange deben apuntar al mismo UserMarkId (bug A4)
    rows = conn.execute("SELECT DISTINCT UserMarkId FROM BlockRange").fetchall()
    assert len(rows) == 1
    um_ids = conn.execute("SELECT UserMarkId FROM UserMark").fetchall()
    assert rows[0][0] == um_ids[0][0]
    assert conn.execute("SELECT COUNT(*) FROM BlockRange").fetchone()[0] == 2

    # NoteTag insertado sin NULLs
    notetags = conn.execute("SELECT NoteId, TagId FROM NoteTag").fetchall()
    assert len(notetags) == 1
    assert notetags[0][0] is not None
    assert notetags[0][1] is not None

    assert counts["tags"] == 1
    assert counts["links"] == 1
    assert counts["marks"] == 1
    assert counts["notes"] == 1
    assert counts["ranges"] == 2


def test_link_with_nonexistent_tag_is_skipped():
    request = ExportRequest(
        marks=[
            MarkExportDTO(
                local_id="m1",
                document_id=1,
                block_index=0,
                color=JWMarkColor.BLUE,
                ranges=[RangeExportDTO(start_token=0, end_token=1, token_count=1)],
                note=NoteExportDTO(
                    title="", content="c", last_modified="2024-01-01T00:00:00Z"
                ),
            )
        ],
        tags=[],
        note_tag_links=[NoteTagLinkDTO(note_mark_index=0, tag_name="no-existe")],
    )
    # No debe lanzar excepción
    conn, _counts = _run(request)
    # Y no debe insertar ningún NoteTag inconsistente
    assert conn.execute("SELECT COUNT(*) FROM NoteTag").fetchone()[0] == 0
