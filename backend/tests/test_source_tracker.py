"""
Tests del SourceTracker — extracción de fuentes desde los resultados de las
herramientas.

Los dicts de ejemplo replican las formas REALES que devuelve
``services/ai/native_tools.py``; si esas formas cambian, estos tests avisan.
Sin red: el tracker solo recibe dicts.
"""

from app.services.ai.source_tracker import Source, SourceTracker


class TestLeerPasajeBiblico:
    ARGS = {"libro": "Isaías", "capitulo": 58, "versiculo": "12"}
    RESULT = {
        "titulo": "Isaías 58:12",
        "texto": "Los tuyos reconstruirán las ruinas…",
        "fuente": "https://wol.jw.org/es/wol/b/r4/lp-s/nwtsty/23/58",
        "idioma": "es",
    }

    def test_produce_una_fuente_de_escritura(self):
        tracker = SourceTracker()
        tracker.record("leer_pasaje_biblico", self.ARGS, self.RESULT)

        assert tracker.sources() == [
            {
                "kind": "scripture",
                "label": "Isaías 58:12",
                "url": self.RESULT["fuente"],
                "identifier": "scripture:isaías:58:12",
            }
        ]

    def test_el_identifier_normaliza_igual_que_native_tools(self):
        # native_tools hace f"scripture:{libro.lower()}:{cap}:{versiculo}":
        # minúsculas SIN quitar acentos. El frontend reusa este identifier tal
        # cual para abrir la referencia, así que tiene que coincidir.
        tracker = SourceTracker()
        tracker.record(
            "leer_pasaje_biblico",
            {"libro": "ISAÍAS", "capitulo": 58, "versiculo": "12"},
            self.RESULT,
        )

        assert tracker.sources()[0]["identifier"] == "scripture:isaías:58:12"

    def test_sin_versiculo_usa_all(self):
        tracker = SourceTracker()
        tracker.record(
            "leer_pasaje_biblico",
            {"libro": "Juan", "capitulo": 3},
            {"titulo": "Juan 3", "fuente": "https://wol.jw.org/x"},
        )

        assert tracker.sources()[0]["identifier"] == "scripture:juan:3:all"

    def test_sin_titulo_no_hay_fuente(self):
        tracker = SourceTracker()
        tracker.record("leer_pasaje_biblico", self.ARGS, {"texto": "algo"})

        assert tracker.sources() == []


class TestAbrirDocumento:
    def test_produce_una_fuente_de_articulo_con_doc_id(self):
        tracker = SourceTracker()
        tracker.record(
            "abrir_documento",
            {"doc_id": 2021123},
            {
                "titulo": "Imite la paciencia de Jehová",
                "publicacion": "w21 mayo págs. 8-12",
                "fuente": "https://wol.jw.org/es/wol/d/r4/lp-s/2021123",
                "texto": "…",
                "truncado": False,
            },
        )

        assert tracker.sources() == [
            {
                "kind": "article",
                "label": "Imite la paciencia de Jehová",
                "citation": "w21 mayo págs. 8-12",
                "url": "https://wol.jw.org/es/wol/d/r4/lp-s/2021123",
                "doc_id": 2021123,
            }
        ]


class TestBuscarEnBiblioteca:
    RESULT = {
        "resultados": [
            {
                "doc_id": 1001 + i,
                "citation": f"w0{i} 1/12 págs. 25-29 - La Atalaya",
                "snippet": "…",
                "publication": f"w0{i}",
                "url": f"https://wol.jw.org/es/wol/d/r4/lp-s/{1001 + i}",
            }
            for i in range(8)
        ]
    }

    def test_una_fuente_por_resultado_con_tope_de_cinco(self):
        # Diez chips de búsqueda tapan las fuentes que sí se abrieron y leyeron.
        tracker = SourceTracker()
        tracker.record("buscar_en_biblioteca", {"consulta": "paciencia"}, self.RESULT)

        sources = tracker.sources()

        assert len(sources) == 5
        assert all(s["kind"] == "search" for s in sources)
        assert sources[0]["doc_id"] == 1001

    def test_una_busqueda_sin_resultados_no_genera_fuentes(self):
        tracker = SourceTracker()
        tracker.record(
            "buscar_en_biblioteca",
            {"consulta": "xyz"},
            {"resultados": [], "aviso": "Sin resultados en wol.jw.org."},
        )

        assert tracker.sources() == []


class TestObtenerTextoDelDia:
    def test_produce_una_fuente_diaria(self):
        tracker = SourceTracker()
        tracker.record(
            "obtener_texto_del_dia",
            {},
            {
                "date_iso": "2026-07-30",
                "date_label": "Jueves 30 de julio",
                "theme_text": "…",
                "theme_scripture_ref": "Efes. 4:8",
                "body": "…",
                "source_url": "https://wol.jw.org/es/wol/dt/r4/lp-s/2026/7/30",
            },
        )

        assert tracker.sources() == [
            {
                "kind": "daily",
                "label": "Texto del día · Jueves 30 de julio",
                "citation": "Efes. 4:8",
                "url": "https://wol.jw.org/es/wol/dt/r4/lp-s/2026/7/30",
            }
        ]


class TestHerramientasDelMcp:
    def test_best_effort_con_title_y_url(self):
        tracker = SourceTracker()
        tracker.record(
            "getWatchtowerContent",
            {"url": "…"},
            {"title": "Keep Your Eyes on the Prize", "url": "https://wol.jw.org/en/x"},
        )

        assert tracker.sources() == [
            {
                "kind": "mcp",
                "label": "Keep Your Eyes on the Prize",
                "url": "https://wol.jw.org/en/x",
            }
        ]

    def test_una_forma_desconocida_no_lanza_y_no_genera_fuentes(self):
        tracker = SourceTracker()
        tracker.record("herramienta_rara", {}, {"foo": 1})
        tracker.record("herramienta_rara", {}, ["no", "soy", "un", "dict"])
        tracker.record("herramienta_rara", None, None)

        assert tracker.sources() == []


class TestReglasGenerales:
    def test_un_resultado_con_error_no_registra_fuente(self):
        tracker = SourceTracker()
        tracker.record(
            "abrir_documento",
            {"doc_id": 1},
            {"error": "No se pudo obtener el documento."},
        )

        assert tracker.sources() == []

    def test_dos_llamadas_identicas_producen_una_sola_fuente(self):
        tracker = SourceTracker()
        args = {"doc_id": 42}
        result = {"titulo": "Un artículo", "publicacion": "w21", "fuente": "u"}

        tracker.record("abrir_documento", args, result)
        tracker.record("abrir_documento", args, result)

        assert len(tracker.sources()) == 1

    def test_el_orden_de_consulta_es_estable(self):
        tracker = SourceTracker()
        tracker.record(
            "leer_pasaje_biblico",
            {"libro": "Juan", "capitulo": 3},
            {"titulo": "Juan 3", "fuente": "u1"},
        )
        tracker.record(
            "abrir_documento",
            {"doc_id": 7},
            {"titulo": "Artículo", "fuente": "u2"},
        )

        assert [s["kind"] for s in tracker.sources()] == ["scripture", "article"]

    def test_los_campos_vacios_no_se_serializan(self):
        # El chip no debe recibir "citation": "" y pintar un subtítulo vacío.
        source = Source(kind="scripture", label="Juan 3:16")

        assert source.to_dict() == {"kind": "scripture", "label": "Juan 3:16"}


class TestSummary:
    def test_cuenta_los_resultados_de_una_busqueda(self):
        assert (
            SourceTracker.summary(
                "buscar_en_biblioteca", {"resultados": [{}, {}, {}]}
            )
            == "3 resultados"
        )
        assert (
            SourceTracker.summary("buscar_en_biblioteca", {"resultados": [{}]})
            == "1 resultado"
        )
        assert (
            SourceTracker.summary("buscar_en_biblioteca", {"resultados": []})
            == "Sin resultados"
        )

    def test_usa_el_titulo_del_pasaje_y_del_articulo(self):
        assert (
            SourceTracker.summary("leer_pasaje_biblico", {"titulo": "Isaías 58"})
            == "Isaías 58"
        )
        assert (
            SourceTracker.summary(
                "abrir_documento", {"titulo": "Un artículo", "truncado": True}
            )
            == "Un artículo (truncado)"
        )

    def test_un_error_se_resume_como_sin_resultado(self):
        assert SourceTracker.summary("abrir_documento", {"error": "boom"}) == "Sin resultado"

    def test_una_forma_desconocida_no_lanza(self):
        assert SourceTracker.summary("lo_que_sea", None) == ""
        assert SourceTracker.summary("lo_que_sea", {"x": 1}) == "Consultado"
