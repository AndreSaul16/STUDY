"""
Tests de las traducciones para comparar.

Sin red: se sustituye ``httpx.get``. Lo que se blinda:

  * Que el catálogo solo ofrezca traducciones que se pueden servir de verdad.
    Una entrada de más aquí es una traducción que da 404 al pulsarla.
  * Que un capítulo repetido en el origen no salga doblado en el lector. Pasó
    con una de las fuentes evaluadas: devolvía 72 versículos para Juan 3.
  * Que un fallo de una traducción no tumbe la comparación entera.
  * Que el Antiguo Testamento no se pida a una traducción que solo tiene el
    Nuevo.
"""

import pytest

from app.services.external import bible_versions as bv


class _Respuesta:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def _capitulo(n_versos=3):
    """La forma REAL de getbible: `verse` viene como cadena, no como número."""
    return {
        "book_name": "Juan",
        "verses": [
            {"chapter": "3", "verse": str(i), "name": f"Juan 3:{i}", "text": f"Verso {i}."}
            for i in range(1, n_versos + 1)
        ],
    }


@pytest.fixture(autouse=True)
def sin_cache(monkeypatch):
    """Cada test parte de cero: la caché es de disco y sobrevive entre tests."""
    monkeypatch.setattr(bv.content_cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(bv.content_cache, "put", lambda *a, **k: None)


class TestCatalogo:
    def test_la_traduccion_del_nuevo_mundo_va_primera_y_marcada(self):
        # Es la de referencia; las demás están para contrastar, no para
        # sustituirla, y el orden lo dice sin necesidad de explicarlo.
        catalogo = bv.catalog()

        assert catalogo[0]["id"] == bv.NWT_ID
        assert catalogo[0]["principal"] is True
        assert all(v["principal"] is False for v in catalogo[1:])

    def test_todas_las_traducciones_son_de_dominio_publico(self):
        # Las modernas conocidas (RV1960, NVI, LBLA) están protegidas por
        # derechos de autor. Que una se cuele aquí sería un problema legal, no
        # un fallo de producto.
        assert all(v.license == "Dominio público" for v in bv.VERSIONS)

    def test_los_ids_no_se_repiten(self):
        ids = [v.id for v in bv.VERSIONS]
        assert len(ids) == len(set(ids))

    @pytest.mark.parametrize("desconocido", ["rvr1960", "nvi", "", None, "  "])
    def test_un_id_desconocido_no_resuelve(self, desconocido):
        assert bv.get_version(desconocido) is None


class TestAlcance:
    def test_una_traduccion_completa_cubre_todo_el_canon(self):
        valera = bv.get_version("valera")
        assert valera.covers(1) and valera.covers(66)

    def test_una_solo_del_nuevo_testamento_no_cubre_el_antiguo(self):
        nt = bv.get_version("rv1858")
        assert not nt.covers(1)      # Génesis
        assert not nt.covers(39)     # Malaquías
        assert nt.covers(40)         # Mateo
        assert nt.covers(66)         # Apocalipsis

    def test_pedir_el_antiguo_a_una_del_nuevo_lo_dice_claro(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: pytest.fail("no debe salir a la red"))

        with pytest.raises(bv.BibleVersionError, match="Escrituras Griegas"):
            bv.fetch_chapter("rv1858", 1, 1)


class TestFetchChapter:
    def test_normaliza_un_capitulo(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(3)))

        capitulo = bv.fetch_chapter("valera", 43, 3)

        assert capitulo.book_name == "Juan"
        assert capitulo.version_label == "Reina-Valera (1909)"
        assert [v.verse for v in capitulo.verses] == [1, 2, 3]

    def test_deduplica_un_capitulo_repetido_en_el_origen(self, monkeypatch):
        # Una de las fuentes evaluadas devolvía Juan 3 dos veces seguidas (72
        # entradas). Sin deduplicar, el lector mostraría el texto doblado.
        doblado = _capitulo(3)
        doblado["verses"] = doblado["verses"] * 2
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(doblado))

        capitulo = bv.fetch_chapter("valera", 43, 3)

        assert [v.verse for v in capitulo.verses] == [1, 2, 3]

    def test_ordena_por_numero_de_versiculo(self, monkeypatch):
        desordenado = _capitulo(3)
        desordenado["verses"].reverse()
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(desordenado))

        capitulo = bv.fetch_chapter("valera", 43, 3)

        assert [v.verse for v in capitulo.verses] == [1, 2, 3]

    def test_aguanta_versiculos_corruptos(self, monkeypatch):
        roto = {
            "book_name": "Juan",
            "verses": [
                {"verse": "1", "text": "Bien."},
                {"verse": "no-es-un-numero", "text": "x"},
                "una cadena suelta",
                {"verse": "3", "text": "   "},   # texto vacío
                {"verse": "4", "text": "También bien."},
            ],
        }
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(roto))

        capitulo = bv.fetch_chapter("valera", 43, 3)

        assert [v.verse for v in capitulo.verses] == [1, 4]

    def test_un_capitulo_sin_versiculos_es_un_error(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta({"verses": []}))

        with pytest.raises(bv.BibleVersionError):
            bv.fetch_chapter("valera", 43, 99)

    def test_un_fallo_de_red_no_expone_la_traza(self, monkeypatch):
        def _revienta(*a, **k):
            raise RuntimeError("connection reset by peer en api.getbible.net")

        monkeypatch.setattr(bv.httpx, "get", _revienta)

        with pytest.raises(bv.BibleVersionError) as exc:
            bv.fetch_chapter("valera", 43, 3)

        assert "getbible" not in str(exc.value)

    @pytest.mark.parametrize("libro,capitulo", [(0, 1), (67, 1), (43, 0)])
    def test_rechaza_coordenadas_imposibles(self, libro, capitulo, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: pytest.fail("no debe salir a la red"))

        with pytest.raises(bv.BibleVersionError):
            bv.fetch_chapter("valera", libro, capitulo)


class TestCompare:
    def test_pone_las_traducciones_en_paralelo(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(20)))

        resultado = bv.compare(43, 3, 16)

        assert [f["version"] for f in resultado["traducciones"]] == [
            "valera",
            "sse",
            "rv1858",
        ]
        assert "aviso" not in resultado

    def test_una_traduccion_caida_no_tumba_la_comparacion(self, monkeypatch):
        def _falla_solo_sse(url, *a, **k):
            if "/sse/" in url:
                raise RuntimeError("502")
            return _Respuesta(_capitulo(20))

        monkeypatch.setattr(bv.httpx, "get", _falla_solo_sse)

        resultado = bv.compare(43, 3, 16)

        assert [f["version"] for f in resultado["traducciones"]] == ["valera", "rv1858"]
        assert "Sagradas Escrituras" in resultado["aviso"]

    def test_en_el_antiguo_testamento_se_omiten_las_del_nuevo(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(20)))

        resultado = bv.compare(1, 1, 1)

        assert "rv1858" not in [f["version"] for f in resultado["traducciones"]]

    def test_se_puede_pedir_solo_una(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(20)))

        resultado = bv.compare(43, 3, 16, ["valera"])

        assert [f["version"] for f in resultado["traducciones"]] == ["valera"]

    def test_un_verso_que_no_existe_no_aparece(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(3)))

        resultado = bv.compare(43, 3, 99)

        assert resultado["traducciones"] == []

    def test_ids_desconocidos_se_ignoran_sin_lanzar(self, monkeypatch):
        monkeypatch.setattr(bv.httpx, "get", lambda *a, **k: _Respuesta(_capitulo(20)))

        resultado = bv.compare(43, 3, 16, ["valera", "rvr1960", "inventada"])

        assert [f["version"] for f in resultado["traducciones"]] == ["valera"]
