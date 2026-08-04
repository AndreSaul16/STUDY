"""
Tests de la búsqueda fuera de jw.org.

Sin red: se parsean respuestas reducidas con la forma real de OpenAlex y
Europe PMC. Lo importante que se blinda:

  * Que el resumen invertido de OpenAlex se reconstruya EN ORDEN. Si no, al
    modelo le llega una bolsa de palabras y se inventa lo que significa.
  * Que la lista blanca de dominios sea lo que decide, no la lista negra.
  * Que el filtro descarte lo apóstata y deje pasar lo demás.
"""

import pytest

from app.services.ai.research_config import ResearchConfig
from app.services.external import web_search as ws


# ─── Resumen invertido de OpenAlex ───────────────────────────────


class TestResumenInvertido:
    def test_reconstruye_en_orden(self):
        invertido = {"El": [0], "aguante": [1], "es": [2], "necesario": [3]}

        assert ws._rebuild_abstract(invertido) == "El aguante es necesario"

    def test_una_palabra_repetida_va_en_sus_dos_sitios(self):
        invertido = {"muy": [0, 2], "muy": [0, 2], "bueno": [1], "raro": [3]}

        assert ws._rebuild_abstract(invertido) == "muy bueno muy raro"

    @pytest.mark.parametrize("entrada", [None, {}, "texto", [1, 2]])
    def test_entrada_invalida_devuelve_vacio(self, entrada):
        assert ws._rebuild_abstract(entrada) == ""

    def test_aguanta_posiciones_corruptas(self):
        assert ws._rebuild_abstract({"a": "no-es-lista", "b": [0]}) == "b"


# ─── OpenAlex ────────────────────────────────────────────────────


def _openalex():
    return {
        "results": [
            {
                "title": "Endurance running and the evolution of Homo",
                "publication_year": 2004,
                "cited_by_count": 1744,
                "doi": "https://doi.org/10.1038/nature03052",
                "primary_location": {
                    "source": {"display_name": "Nature"},
                    "landing_page_url": "https://nature.com/articles/nature03052",
                },
                "open_access": {"is_oa": False},
                "abstract_inverted_index": {"Humans": [0], "run": [1], "far": [2]},
                "authorships": [
                    {"author": {"display_name": "D. Bramble"}},
                    {"author": {"display_name": "D. Lieberman"}},
                ],
            },
            {"title": "", "publication_year": 2020},
        ]
    }


class TestParseoOpenAlex:
    def test_normaliza_un_trabajo(self, monkeypatch):
        monkeypatch.setattr(ws, "_get", lambda *a, **k: _openalex())

        resultados = ws.search_openalex("x")

        assert len(resultados) == 1  # el del título vacío se descarta
        primero = resultados[0]
        assert primero.year == 2004
        assert primero.source == "Nature"
        assert primero.citations == 1744
        assert primero.summary == "Humans run far"
        assert primero.authors == "D. Bramble, D. Lieberman"
        assert primero.catalog == "openalex"

    def test_el_to_dict_omite_lo_que_no_hay(self):
        item = ws.ExternalResult(title="t", url="u", summary="s", source="S")
        data = item.to_dict()

        assert "anio" not in data
        assert "veces_citado" not in data
        assert data["titulo"] == "t"


# ─── Europe PMC ──────────────────────────────────────────────────


def _europepmc():
    return {
        "resultList": {
            "result": [
                {
                    "title": "Resilience and endurance",
                    "pubYear": "2021",
                    "journalTitle": "Frontiers in Psychology",
                    "doi": "10.3389/fpsyg.2021.1",
                    "abstractText": "Un resumen cualquiera.",
                    "citedByCount": 38,
                    "isOpenAccess": "Y",
                    "authorString": "García J, López M.",
                },
                {
                    "title": "Sin doi ni pmid",
                    "pubYear": "no-es-un-ano",
                    "abstractText": "x",
                },
            ]
        }
    }


class TestParseoEuropePmc:
    def test_normaliza_un_articulo(self, monkeypatch):
        monkeypatch.setattr(ws, "_get", lambda *a, **k: _europepmc())

        primero, segundo = ws.search_europepmc("x")

        assert primero.year == 2021
        assert primero.url == "https://doi.org/10.3389/fpsyg.2021.1"
        assert primero.open_access is True
        assert primero.citations == 38

        # Un año ilegible no puede tumbar el parseo del resto.
        assert segundo.year is None
        assert segundo.url == ""


# ─── Lista blanca ────────────────────────────────────────────────


class TestListaBlanca:
    @pytest.mark.parametrize(
        "url",
        [
            "https://nature.com/x",
            "https://www.nature.com/x",
            "https://blogs.nature.com/x",  # subdominio
            "https://ncbi.nlm.nih.gov/x",
            "https://britannica.com/x",
        ],
    )
    def test_admite_los_dominios_de_referencia(self, url):
        assert ws._is_reputable(url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://blog-cualquiera.example/x",
            "https://medium.com/@alguien/x",
            "https://nature.com.falso.example/x",  # no es nature.com
            "",
        ],
    )
    def test_rechaza_todo_lo_demas(self, url):
        assert not ws._is_reputable(url)

    def test_sin_clave_no_hay_buscador_generalista(self, monkeypatch):
        monkeypatch.delenv("WEB_SEARCH_API_KEY", raising=False)

        assert ws.general_web_provider() == ""
        assert ws.search_general_web("x") == []


# ─── Recorte de resúmenes ────────────────────────────────────────


class TestRecorte:
    def test_corta_por_frase_completa(self):
        texto = "Primera frase. " + "y " * 500 + "final."
        recortado = ws._shorten(texto, limit=60)

        assert recortado.endswith("[…]")
        assert len(recortado) <= 70

    def test_no_toca_lo_que_ya_cabe(self):
        assert ws._shorten("Corto.", limit=60) == "Corto."


# ─── Punto de entrada ────────────────────────────────────────────


class TestSearch:
    def test_apagado_lanza_disabled(self):
        with pytest.raises(ws.WebSearchDisabled):
            ws.search("x", ResearchConfig(internet=False))

    def test_consulta_vacia_no_sale_a_la_red(self):
        informe = ws.search("   ", ResearchConfig(internet=True))

        assert informe.results == []
        assert "Falta la consulta" in informe.notice

    def test_un_catalogo_caido_no_tumba_la_busqueda(self, monkeypatch):
        monkeypatch.setattr(ws.content_cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(ws.content_cache, "put", lambda *a, **k: None)
        monkeypatch.setattr(
            ws, "search_openalex", lambda *a, **k: (_ for _ in ()).throw(ws.WebSearchError())
        )
        monkeypatch.setattr(
            ws,
            "search_europepmc",
            lambda *a, **k: [ws.ExternalResult("Pingüinos", "https://nature.com/a", "s", "Nature")],
        )

        informe = ws.search("x", ResearchConfig(internet=True))

        assert [r["titulo"] for r in informe.results] == ["Pingüinos"]
        assert "OpenAlex" in informe.notice

    def test_el_filtro_bloquea_lo_apostata_y_deja_lo_demas(self, monkeypatch):
        cacheado = {
            "items": [
                {"titulo": "Apostasía", "resumen": "apostata", "url": "https://jwfacts.com/a"},
                {"titulo": "Pingüinos", "resumen": "frío", "url": "https://nature.com/b"},
            ],
            "fallos": [],
        }
        monkeypatch.setattr(ws.content_cache, "get", lambda *a, **k: cacheado)

        con_filtro = ws.search("x", ResearchConfig(internet=True, doctrinal_filter=True))
        sin_filtro = ws.search("x", ResearchConfig(internet=True, doctrinal_filter=False))

        assert [r["titulo"] for r in con_filtro.results] == ["Pingüinos"]
        assert con_filtro.blocked == 1
        assert len(sin_filtro.results) == 2
        assert sin_filtro.blocked == 0

    def test_los_temas_a_contrastar_viajan_en_el_payload(self, monkeypatch):
        cacheado = {
            "items": [
                {
                    "titulo": "Evolution of the eye",
                    "resumen": "natural selection",
                    "url": "https://science.org/b",
                }
            ],
            "fallos": [],
        }
        monkeypatch.setattr(ws.content_cache, "get", lambda *a, **k: cacheado)

        informe = ws.search("x", ResearchConfig(internet=True))

        assert informe.topics == ["origenes"]
        assert informe.to_dict()["temas_a_contrastar"] == ["origenes"]
        assert "aviso_doctrinal" in informe.results[0]
