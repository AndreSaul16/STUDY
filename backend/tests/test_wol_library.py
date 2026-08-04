"""
Tests del parseo de wol.jw.org.

Sin red: se parsea HTML reducido que reproduce la estructura real observada en
wol.jw.org. Lo que se comprueba aquí es justo lo que rompería en silencio si
WOL cambiase el marcado.
"""

from collections import OrderedDict

import pytest
from bs4 import BeautifulSoup

from app.services.jw import wol_library as wol
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


class TestEscaleraDeCercania:
    """
    El arreglo del fallo más molesto que tuvo la app.

    WOL pedía siempre ``p=par`` (todos los términos en el MISMO párrafo). Con
    dos palabras va de sobra; con una pregunta en lenguaje natural devuelve
    cero. Medido en vivo con la consulta real del usuario "usar jw.org alguien
    habla otro idioma predicación": ``par`` → 0 resultados, ``doc`` → 17. El
    agente concluía "no encontré nada" y se negaba a responder con material que
    sí estaba ahí.
    """

    def _falso_get(self, respuestas):
        """Devuelve un `_get` de mentira que anota con qué cercanía se le llama."""
        llamadas = []

        def _get(url, params=None):
            cercania = (params or {}).get("p")
            llamadas.append(cercania)
            return respuestas.get(cercania, "")

        return _get, llamadas

    def test_empieza_por_lo_preciso_y_no_relaja_si_encuentra(self, monkeypatch):
        # Una consulta corta que funciona no debe pagar una petición extra ni
        # perder precisión bajando a "mismo artículo".
        html = """
        <li class="result">
          <ul class="resultItems">
            <li class="searchResult docId-42 pub-w20">fragmento</li>
            <li class="ref">w20 abril pág. 3 - La Atalaya 2020</li>
          </ul>
        </li>
        """
        _get, llamadas = self._falso_get({"par": html})
        monkeypatch.setattr(wol, "_get", _get)
        monkeypatch.setattr(wol, "_search_cache", OrderedDict())
        monkeypatch.setattr(wol.content_cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(wol.content_cache, "put", lambda *a, **k: None)

        results = wol.search_library("otro idioma", limit=5)

        assert len(results) == 1
        assert llamadas == ["par"]

    def test_si_lo_preciso_no_encuentra_nada_se_relaja(self, monkeypatch):
        html = """
        <li class="result">
          <ul class="resultItems">
            <li class="searchResult docId-7 pub-od">fragmento</li>
            <li class="ref">od cap. 9 págs. 87-104 - Organizados  (od)</li>
          </ul>
        </li>
        """
        # "par" no devuelve nada; "doc" sí. Es el caso real que se rompía.
        _get, llamadas = self._falso_get({"par": "<html></html>", "doc": html})
        monkeypatch.setattr(wol, "_get", _get)
        monkeypatch.setattr(wol, "_search_cache", OrderedDict())
        monkeypatch.setattr(wol.content_cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(wol.content_cache, "put", lambda *a, **k: None)

        results = wol.search_library(
            "usar jw.org alguien habla otro idioma predicación", limit=5
        )

        assert llamadas == ["par", "doc"]
        assert [r.doc_id for r in results] == [7]

    def test_si_ninguna_cercania_encuentra_nada_devuelve_vacio(self, monkeypatch):
        _get, llamadas = self._falso_get({})
        monkeypatch.setattr(wol, "_get", _get)
        monkeypatch.setattr(wol, "_search_cache", OrderedDict())
        monkeypatch.setattr(wol.content_cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(wol.content_cache, "put", lambda *a, **k: None)

        assert wol.search_library("algo que no existe", limit=5) == []
        # Se agota la escalera entera antes de rendirse.
        assert llamadas == list(wol.PROXIMITY_LADDER)

    def test_la_escalera_va_de_estricta_a_laxa(self):
        # Si alguien la reordena, las consultas cortas pierden precisión.
        assert wol.PROXIMITY_LADDER == ("par", "doc")
