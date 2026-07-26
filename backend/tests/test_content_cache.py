"""
Tests de la caché de contenido.

El contenido publicado de wol.jw.org es inmutable, así que se guarda en disco:
una relectura pasa de segundos a microsegundos y sobrevive al reinicio. Lo que
se comprueba aquí es que las dos políticas se respetan (documentos permanentes,
búsquedas con caducidad) y —sobre todo— que una caché rota nunca impide leer.
"""

import importlib
import time

import pytest


@pytest.fixture()
def cache(tmp_path, monkeypatch):
    """Una caché aislada por test, en su propio directorio temporal."""
    monkeypatch.setenv("CONTENT_CACHE_PATH", str(tmp_path / "content.db"))
    from app.services.jw import content_cache

    modulo = importlib.reload(content_cache)
    yield modulo
    modulo._conn = None


class TestGuardarYRecuperar:
    def test_guarda_y_devuelve_lo_mismo(self, cache):
        cache.put("document", "123", {"title": "Un artículo", "blocks": [1, 2, 3]})

        assert cache.get("document", "123") == {
            "title": "Un artículo",
            "blocks": [1, 2, 3],
        }

    def test_lo_que_no_esta_devuelve_none(self, cache):
        assert cache.get("document", "no-existe") is None

    def test_los_tipos_no_se_pisan_entre_si(self, cache):
        cache.put("document", "1", {"a": 1})
        cache.put("chapter", "1", {"b": 2})

        assert cache.get("document", "1") == {"a": 1}
        assert cache.get("chapter", "1") == {"b": 2}

    def test_volver_a_guardar_sobrescribe(self, cache):
        cache.put("chapter", "43:3", {"v": "viejo"})
        cache.put("chapter", "43:3", {"v": "nuevo"})

        assert cache.get("chapter", "43:3") == {"v": "nuevo"}

    def test_conserva_los_acentos(self, cache):
        cache.put("verse", "x", {"texto": "Jehová es mi Pastor. Nada me faltará."})

        assert "Jehová" in cache.get("verse", "x")["texto"]


class TestCaducidad:
    def test_sin_ttl_es_permanente(self, cache):
        cache.put("document", "1", {"a": 1})

        # Un artículo publicado no cambia: no hay motivo para releerlo nunca.
        assert cache.get("document", "1") is not None

    def test_con_ttl_vencido_devuelve_none(self, cache):
        cache.put("search", "amor", [{"doc_id": 1}], ttl_seconds=-1)

        # Las búsquedas sí caducan: WOL añade publicaciones nuevas.
        assert cache.get("search", "amor") is None

    def test_con_ttl_vigente_sigue_valiendo(self, cache):
        cache.put("search", "amor", [{"doc_id": 1}], ttl_seconds=3600)

        assert cache.get("search", "amor") == [{"doc_id": 1}]

    def test_la_entrada_caducada_se_limpia(self, cache):
        cache.put("search", "amor", [1], ttl_seconds=-1)
        cache.get("search", "amor")

        assert cache.stats()["entries"].get("search", {}).get("count", 0) == 0


class TestPersistencia:
    def test_sobrevive_a_reabrir_la_conexion(self, cache):
        cache.put("chapter", "43:3", {"verses": 36})
        # Simula el reinicio del proceso: se suelta la conexión y se reabre.
        cache._conn = None

        assert cache.get("chapter", "43:3") == {"verses": 36}


class TestTolerancia:
    def test_una_ruta_imposible_no_rompe_nada(self, monkeypatch, tmp_path):
        # Una caché rota debe degradar a "sin caché", nunca impedir la lectura.
        fichero = tmp_path / "soy-un-fichero"
        fichero.write_text("x")
        monkeypatch.setenv("CONTENT_CACHE_PATH", str(fichero / "imposible.db"))

        from app.services.jw import content_cache

        modulo = importlib.reload(content_cache)
        try:
            modulo.put("document", "1", {"a": 1})
            assert modulo.get("document", "1") is None
            assert modulo.stats()["available"] is False
        finally:
            modulo._conn = None

    def test_una_entrada_corrupta_se_descarta(self, cache):
        cache.put("document", "1", {"a": 1})
        conn = cache._connect()
        conn.execute("UPDATE content SET payload = 'esto no es json'")
        conn.commit()

        assert cache.get("document", "1") is None


class TestEstadisticas:
    def test_informa_de_lo_guardado_por_tipo(self, cache):
        cache.put("document", "1", {"a": 1})
        cache.put("document", "2", {"a": 2})
        cache.put("chapter", "43:3", {"b": 1})

        entradas = cache.stats()["entries"]
        assert entradas["document"]["count"] == 2
        assert entradas["chapter"]["count"] == 1
        assert entradas["document"]["bytes"] > 0
