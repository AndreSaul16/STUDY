"""
Tests del catálogo bíblico y del parseo de capítulos.

Sin red: el parseo se ejercita contra HTML reducido con la misma forma que el
de wol.jw.org (``span.v`` con id ``v{libro}-{cap}-{versiculo}-{seq}``).
"""

import pytest

from app.services.jw.book_numbers import all_books, chapter_count, book_number
from app.services.references.reference_resolver import _parse_wol_chapter_verses


class TestCatalogoDeLibros:
    def test_hay_sesenta_y_seis_libros(self):
        assert len(all_books()) == 66

    def test_la_division_hebreas_griegas_es_la_correcta(self):
        books = {b["number"]: b for b in all_books()}
        assert books[39]["section"] == "hebreas"  # Malaquías
        assert books[40]["section"] == "griegas"  # Mateo

    @pytest.mark.parametrize(
        "nombre,capitulos",
        [("Salmos", 150), ("Juan", 21), ("Génesis", 50), ("Abdías", 1), ("Apocalipsis", 22)],
    )
    def test_numero_de_capitulos_conocido(self, nombre, capitulos):
        assert chapter_count(book_number(nombre)) == capitulos

    def test_todos_los_libros_declaran_capitulos(self):
        sin_capitulos = [b["name"] for b in all_books() if b["chapters"] < 1]
        assert sin_capitulos == []


class TestParseoDeCapitulo:
    def test_extrae_los_versiculos_en_orden(self):
        html = """
        <span class="v" id="v43-3-1-1"><a>1</a>Había entre los fariseos un hombre.</span>
        <span class="v" id="v43-3-2-1"><a>2</a>Él fue a ver a Jesús de noche.</span>
        """

        verses = _parse_wol_chapter_verses(html, book_num=43, chapter=3)

        assert [v for v, _ in verses] == [1, 2]
        assert verses[0][1] == "Había entre los fariseos un hombre."

    def test_une_los_fragmentos_de_un_mismo_versiculo(self):
        # WOL parte un versículo en varios span.v cuando lleva marcado interno.
        html = """
        <span class="v" id="v43-3-16-1"><a>16</a>Porque Dios amó tanto al mundo</span>
        <span class="v" id="v43-3-16-2">que entregó a su Hijo unigénito.</span>
        """

        verses = _parse_wol_chapter_verses(html, book_num=43, chapter=3)

        assert len(verses) == 1
        assert verses[0][1] == "Porque Dios amó tanto al mundo que entregó a su Hijo unigénito."

    def test_omite_la_superscripcion_del_salmo(self):
        # El versículo 0 es el encabezamiento, no texto del capítulo.
        html = """
        <span class="v" id="v19-23-0-1">Canción de David.</span>
        <span class="v" id="v19-23-1-1"><a>1</a>Jehová es mi Pastor.</span>
        """

        verses = _parse_wol_chapter_verses(html, book_num=19, chapter=23)

        assert [v for v, _ in verses] == [1]

    def test_ignora_versiculos_de_otro_capitulo(self):
        html = """
        <span class="v" id="v43-3-1-1"><a>1</a>Del capítulo 3.</span>
        <span class="v" id="v43-4-1-1"><a>1</a>Del capítulo 4.</span>
        """

        verses = _parse_wol_chapter_verses(html, book_num=43, chapter=3)

        assert [t for _, t in verses] == ["Del capítulo 3."]

    def test_quita_los_marcadores_de_referencia_cruzada(self):
        html = (
            '<span class="v" id="v43-3-1-1"><a>1</a>Texto<a class="b">+</a> del versículo.</span>'
        )

        verses = _parse_wol_chapter_verses(html, book_num=43, chapter=3)

        assert verses[0][1] == "Texto del versículo."

    def test_capitulo_sin_versiculos_devuelve_lista_vacia(self):
        assert _parse_wol_chapter_verses("<p>nada</p>", book_num=43, chapter=3) == []
