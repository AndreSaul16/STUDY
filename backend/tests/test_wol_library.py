"""
Tests del parseo de wol.jw.org.

Sin red: se parsea HTML reducido que reproduce la estructura real observada en
wol.jw.org. Lo que se comprueba aquí es justo lo que rompería en silencio si
WOL cambiase el marcado.
"""

import pytest
from bs4 import BeautifulSoup

from app.services.jw.wol_library import _extract_blocks


def _article(inner_html: str):
    soup = BeautifulSoup(f"<article id='article'>{inner_html}</article>", "html.parser")
    return soup.select_one("#article")


class TestExtractBlocks:
    def test_mapea_las_clases_de_wol_a_tipos_de_bloque(self):
        article = _article(
            """
            <p class="st">¿Qué implica amar al prójimo?</p>
            <p class="sa">“Tienes que amar a tu prójimo como a ti mismo.”</p>
            <p class="ss">¿Quién es mi prójimo?</p>
            <p class="qu">1. ¿Qué implica amar a Dios?</p>
            <p class="sb">Jesús lo resumió en unas palabras sencillas.</p>
            """
        )

        blocks = _extract_blocks(article)

        assert [b.block_type for b in blocks] == [
            "title",
            "scripture",
            "heading",
            "question",
            "paragraph",
        ]

    def test_los_parrafos_anidados_no_duplican_el_texto(self):
        # WOL anida <p> dentro de <p> en algunas secciones; si se emitieran
        # ambos, el mismo texto saldría dos veces en el lector.
        article = _article(
            "<p class='qu'><p>Pregunta</p><p>Respuesta</p></p>"
        )

        blocks = _extract_blocks(article)

        assert [b.content for b in blocks] == ["Pregunta", "Respuesta"]

    def test_quita_los_marcadores_de_nota_al_pie(self):
        article = _article(
            "<p class='sb'>Texto del párrafo<a class='fn'>*</a> y más texto.</p>"
        )

        blocks = _extract_blocks(article)

        assert blocks[0].content == "Texto del párrafo y más texto."

    def test_ignora_los_parrafos_vacios(self):
        article = _article("<p class='sb'></p><p class='sb'>   </p><p class='sb'>Real</p>")

        blocks = _extract_blocks(article)

        assert [b.content for b in blocks] == ["Real"]

    def test_los_ids_de_bloque_son_consecutivos_desde_uno(self):
        article = _article(
            "<p class='sb'>Uno</p><p class='sb'>Dos</p><p class='sb'>Tres</p>"
        )

        blocks = _extract_blocks(article)

        assert [b.block_id for b in blocks] == [1, 2, 3]

    def test_un_tipo_desconocido_cae_en_parrafo(self):
        article = _article("<p class='zzz'>Texto con clase que no conocemos</p>")

        blocks = _extract_blocks(article)

        assert blocks[0].block_type == "paragraph"
