"""
Tests del cliente de jw.org.

Sin red: se parsean estructuras reducidas que reproducen las respuestas reales
observadas en los endpoints públicos (búsqueda y mediator). Lo que se comprueba
es justo lo que rompería en silencio si jw.org cambiara la forma.
"""

import pytest

from app.services.jw import jw_org


# ─── Aplanado de la búsqueda ─────────────────────────────────────


def _respuesta_busqueda():
    """Forma real: grupos anidados con items dentro."""
    return {
        "layout": ["flat"],
        "results": [
            {
                "type": "group",
                "results": [
                    {
                        "type": "item",
                        "subtype": "article",
                        "lank": "pa-1200001360",
                        "context": "Perspicacia para comprender las Escrituras",
                        "title": "Aguante",
                        "snippet": "denota “<strong>aguante</strong>” valeroso",
                        "links": {
                            "jw.org": "https://www.jw.org/open?docid=1200001360&wtlocale=S",
                            "wol": "https://wol.jw.org/wol/finder?wtlocale=S&docid=1200001360&p=doc",
                        },
                    }
                ],
            },
            {
                "type": "group",
                "label": "Videos",
                "results": [
                    {
                        "type": "item",
                        "subtype": "video",
                        "lank": "pub-jwbcov_201705_15_VIDEO",
                        "title": "Tenemos que correr con aguante",
                        "snippet": "fragmento genérico",
                        "duration": "2:31",
                        "links": {"jw.org": "https://www.jw.org/open?docid=1"},
                        "deepLinks": [
                            {
                                "jumpLabel": "Ir a 15:09",
                                "snippet": "ejemplo de fe y <strong>aguante</strong>",
                            }
                        ],
                    }
                ],
            },
        ],
    }


class TestParseoDeResultados:
    def test_aplana_los_grupos_anidados(self):
        items = list(jw_org._walk_items(_respuesta_busqueda()))

        assert [i["subtype"] for i in items] == ["article", "video"]

    def test_saca_el_doc_id_de_wol_del_enlace(self):
        # El puente con wol_library: ese docid ES el que come get_document.
        item = list(jw_org._walk_items(_respuesta_busqueda()))[0]
        parsed = jw_org._parse_item(item)

        assert parsed.doc_id == 1200001360
        assert parsed.kind == "article"

    def test_limpia_el_marcado_de_resaltado(self):
        item = list(jw_org._walk_items(_respuesta_busqueda()))[0]

        assert "<strong>" not in jw_org._parse_item(item).snippet

    def test_el_video_usa_los_fragmentos_con_marca_de_tiempo(self):
        # Valen más que el snippet genérico: dicen DÓNDE está lo que buscabas.
        item = list(jw_org._walk_items(_respuesta_busqueda()))[1]
        parsed = jw_org._parse_item(item)

        assert "[Ir a 15:09]" in parsed.snippet
        assert parsed.duration == "2:31"

    def test_el_ano_sale_del_lank_y_no_del_titulo(self):
        items = list(jw_org._walk_items(_respuesta_busqueda()))

        # El vídeo tiene _201705_ en la clave.
        assert jw_org._parse_item(items[1]).year == 2017
        # El artículo no tiene señal fiable: mejor None que un año inventado.
        assert jw_org._parse_item(items[0]).year is None

    def test_un_item_sin_lank_o_sin_titulo_se_descarta(self):
        assert jw_org._parse_item({"title": "x"}) is None
        assert jw_org._parse_item({"lank": "x"}) is None

    def test_to_dict_habla_en_espanol(self):
        item = list(jw_org._walk_items(_respuesta_busqueda()))[0]
        data = jw_org._parse_item(item).to_dict()

        assert set(data) >= {"lank", "tipo", "titulo", "fragmento", "anio", "doc_id"}


# ─── Subtítulos ──────────────────────────────────────────────────

VTT = """WEBVTT

NOTE esto es un comentario

1
00:02.147 --> 00:03.629
Buenos días.

00:03.628 --> 00:05.796
<v Locutor>Hoy analizaremos</v>

00:05.797 --> 00:09.050
Hoy analizaremos

00:09.050 --> 00:10.927
el capítulo cuatro.
"""


class TestParseVtt:
    def test_convierte_los_subtitulos_en_texto_corrido(self):
        assert jw_org.parse_vtt(VTT) == (
            "Buenos días. Hoy analizaremos el capítulo cuatro."
        )

    def test_quita_marcas_de_tiempo_cabecera_notas_e_indices(self):
        salida = jw_org.parse_vtt(VTT)

        assert "WEBVTT" not in salida
        assert "-->" not in salida
        assert "NOTE" not in salida

    def test_quita_las_etiquetas_de_estilo(self):
        assert "<v" not in jw_org.parse_vtt(VTT)

    def test_deduplica_lineas_repetidas_seguidas(self):
        # Los subtítulos de rodillo repiten la última frase en el bloque
        # siguiente; sin deduplicar el texto sale doblado.
        assert jw_org.parse_vtt(VTT).count("Hoy analizaremos") == 1

    @pytest.mark.parametrize("entrada", ["", None, "WEBVTT\n\n"])
    def test_entrada_vacia_no_revienta(self, entrada):
        assert jw_org.parse_vtt(entrada) == ""


# ─── Ficha del vídeo ─────────────────────────────────────────────


class TestSubtitlesUrl:
    def test_coge_la_primera_url_de_subtitulos(self):
        media = {
            "files": [
                {"label": "240p", "subtitles": None},
                {"label": "480p", "subtitles": {"url": "https://cdn/x.vtt"}},
            ]
        }

        assert jw_org._subtitles_url(media) == "https://cdn/x.vtt"

    def test_sin_subtitulos_devuelve_vacio(self):
        assert jw_org._subtitles_url({"files": [{"label": "240p"}]}) == ""
        assert jw_org._subtitles_url({}) == ""


class TestJwVideo:
    def test_el_ano_sale_de_la_fecha_de_publicacion(self):
        video = jw_org.JwVideo(
            lank="x",
            title="t",
            description="",
            published="2018-03-26T17:15:20.035Z",
            duration="2m",
            url="u",
        )

        assert video.year == 2018
        assert video.to_dict()["anio"] == 2018

    def test_sin_fecha_el_ano_es_none(self):
        video = jw_org.JwVideo(
            lank="x", title="t", description="", published="", duration="", url="u"
        )

        assert video.year is None
