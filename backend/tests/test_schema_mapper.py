"""
Tests del SchemaMapper contra el esquema REAL de JW Library.

El esquema sale de `USERDATA_DB_SCHEMA`, que es un volcado literal de un backup
real (schemaVersion 16). Los tests anteriores validaban contra un esquema
inventado, así que estaban en verde mientras la exportación real fallaba en la
primera sentencia con "table Tag has no column named Color".
"""

import sqlite3

import pytest

from app.schemas.interop_schemas import ExportRequest, USERDATA_DB_SCHEMA
from app.services.interop.schema_mapper import SchemaMapper

JUAN_3 = {
    "book_number": 43,
    "chapter_number": 3,
    "key_symbol": "nwtsty",
    "meps_language": 1,
}


@pytest.fixture()
def conn():
    """
    Base en memoria con el esquema real.

    `LastModified` tiene triggers que prohíben INSERT y DELETE: solo admite
    UPDATE sobre su única fila, que JW Library siembra al crear la base. Para
    reproducir ese estado inicial hay que apartar el guardián un momento.
    """
    c = sqlite3.connect(":memory:")
    c.executescript(USERDATA_DB_SCHEMA)
    c.execute("DROP TRIGGER TR_Raise_Error_Before_Insert_LastModified")
    c.execute("INSERT INTO LastModified (LastModified) VALUES ('2026-01-01T00:00:00Z')")
    c.executescript(
        "CREATE TRIGGER TR_Raise_Error_Before_Insert_LastModified "
        "BEFORE INSERT ON LastModified BEGIN "
        "SELECT RAISE (FAIL, 'INSERT INTO LastModified not allowed'); END"
    )
    yield c
    c.close()


def _request(**overrides) -> ExportRequest:
    base = {
        "marks": [
            {
                "local_id": "m1",
                "guid": "guid-1",
                "location": JUAN_3,
                "color": 3,
                "ranges": [{"identifier": 16, "block_type": 2}],
            }
        ],
        "tags": [],
        "note_tag_links": [],
    }
    base.update(overrides)
    return ExportRequest.model_validate(base)


def _con_nota(contenido: str) -> ExportRequest:
    return _request(
        marks=[
            {
                "local_id": "m1",
                "guid": "guid-1",
                "location": JUAN_3,
                "color": 3,
                "ranges": [{"identifier": 16, "block_type": 2}],
                "note": {"guid": "n1", "title": "T", "content": contenido},
            }
        ]
    )


class TestLocation:
    def test_crea_la_localizacion_de_un_capitulo_biblico(self, conn):
        SchemaMapper().merge(conn, _request())

        assert conn.execute(
            "SELECT BookNumber, ChapterNumber, KeySymbol, Type FROM Location"
        ).fetchone() == (43, 3, "nwtsty", 0)

    def test_reutiliza_la_localizacion_existente(self, conn):
        # Las marcas nuevas en Juan 3 deben colgar de la fila que ya hubiera,
        # no de un duplicado. El esquema lo impone además con un UNIQUE.
        mapper = SchemaMapper()
        mapper.merge(conn, _request())
        mapper.merge(
            conn,
            _request(
                marks=[
                    {
                        "local_id": "m2",
                        "guid": "guid-2",
                        "location": JUAN_3,
                        "color": 1,
                        "ranges": [{"identifier": 17, "block_type": 2}],
                    }
                ]
            ),
        )

        assert conn.execute("SELECT COUNT(*) FROM Location").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM UserMark").fetchone()[0] == 2

    def test_localizacion_de_publicacion_por_document_id(self, conn):
        SchemaMapper().merge(
            conn,
            _request(
                marks=[
                    {
                        "local_id": "m1",
                        "location": {"document_id": 2020522, "meps_language": 1},
                        "color": 2,
                        "ranges": [{"identifier": 6, "block_type": 1}],
                    }
                ]
            ),
        )
        assert conn.execute("SELECT DocumentId FROM Location").fetchone()[0] == 2020522

    def test_una_localizacion_vacia_se_omite_sin_romper(self, conn):
        # Sin libro/capítulo ni document_id no cumpliría el CHECK de Type = 0.
        counts = SchemaMapper().merge(
            conn,
            _request(
                marks=[
                    {
                        "local_id": "huerfana",
                        "location": {"meps_language": 1},
                        "color": 1,
                        "ranges": [{"identifier": 1, "block_type": 1}],
                    }
                ]
            ),
        )
        assert counts.marks_created == 0
        assert len(counts.skipped) == 1
        assert conn.execute("SELECT COUNT(*) FROM UserMark").fetchone()[0] == 0


class TestFusionPorGuid:
    def test_reexportar_actualiza_en_vez_de_duplicar(self, conn):
        mapper = SchemaMapper()
        mapper.merge(conn, _request())
        counts = mapper.merge(conn, _request())

        assert (counts.marks_created, counts.marks_updated) == (0, 1)
        assert conn.execute("SELECT COUNT(*) FROM UserMark").fetchone()[0] == 1

    def test_el_color_se_actualiza_al_reexportar(self, conn):
        mapper = SchemaMapper()
        mapper.merge(conn, _request())
        otra = _request()
        otra.marks[0].color = 5
        mapper.merge(conn, otra)

        assert conn.execute("SELECT ColorIndex FROM UserMark").fetchone()[0] == 5

    def test_la_nota_se_actualiza_por_su_guid(self, conn):
        mapper = SchemaMapper()
        mapper.merge(conn, _con_nota("original"))
        mapper.merge(conn, _con_nota("editada"))

        assert conn.execute("SELECT COUNT(*) FROM Note").fetchone()[0] == 1
        assert conn.execute("SELECT Content FROM Note").fetchone()[0] == "editada"

    def test_sin_guid_se_genera_uno_distinto_cada_vez(self, conn):
        mapper = SchemaMapper()
        sin_guid = _request()
        sin_guid.marks[0].guid = None
        mapper.merge(conn, sin_guid)
        mapper.merge(conn, sin_guid)

        assert conn.execute("SELECT COUNT(*) FROM UserMark").fetchone()[0] == 2


class TestRangos:
    def test_varios_rangos_en_la_misma_marca(self, conn):
        SchemaMapper().merge(
            conn,
            _request(
                marks=[
                    {
                        "local_id": "m1",
                        "guid": "g1",
                        "location": JUAN_3,
                        "color": 1,
                        "ranges": [
                            {"identifier": 16, "block_type": 2},
                            {"identifier": 17, "block_type": 2},
                        ],
                    }
                ]
            ),
        )
        assert conn.execute("SELECT COUNT(*) FROM BlockRange").fetchone()[0] == 2

    def test_los_tokens_nulos_son_validos(self, conn):
        # No se conoce la tokenización de JW Library. El esquema admite NULL,
        # que es preferible a inventar posiciones que caerían en otras palabras.
        SchemaMapper().merge(conn, _request())
        assert conn.execute(
            "SELECT StartToken, EndToken FROM BlockRange"
        ).fetchone() == (None, None)

    def test_reexportar_no_acumula_rangos(self, conn):
        mapper = SchemaMapper()
        mapper.merge(conn, _request())
        mapper.merge(conn, _request())
        assert conn.execute("SELECT COUNT(*) FROM BlockRange").fetchone()[0] == 1


class TestEtiquetas:
    def test_la_nota_se_enlaza_por_tagmap(self, conn):
        peticion = _con_nota("c")
        peticion.tags = ExportRequest.model_validate(
            {"tags": [{"name": "Investigación", "tag_type": 1}]}
        ).tags
        peticion.note_tag_links = ExportRequest.model_validate(
            {"note_tag_links": [{"note_mark_index": 0, "tag_name": "Investigación"}]}
        ).note_tag_links

        SchemaMapper().merge(conn, peticion)

        fila = conn.execute("SELECT TagId, NoteId, Position FROM TagMap").fetchone()
        assert fila is not None
        assert fila[2] == 0  # primera posición dentro de la etiqueta

    def test_un_enlace_a_etiqueta_inexistente_se_ignora(self, conn):
        peticion = _con_nota("c")
        peticion.note_tag_links = ExportRequest.model_validate(
            {"note_tag_links": [{"note_mark_index": 0, "tag_name": "no-existe"}]}
        ).note_tag_links

        counts = SchemaMapper().merge(conn, peticion)

        assert counts.tag_links_created == 0
        assert conn.execute("SELECT COUNT(*) FROM TagMap").fetchone()[0] == 0

    def test_la_etiqueta_existente_se_reutiliza(self, conn):
        conn.execute("INSERT INTO Tag (Type, Name) VALUES (1, 'Investigación')")
        counts = SchemaMapper().merge(
            conn, _request(tags=[{"name": "Investigación", "tag_type": 1}])
        )
        assert counts.tags_created == 0
        assert conn.execute("SELECT COUNT(*) FROM Tag").fetchone()[0] == 1
