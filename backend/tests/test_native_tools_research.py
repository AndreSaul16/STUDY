"""
Tests de las herramientas nuevas y de cómo obedecen a la configuración.

Sin red: se sustituyen los buscadores. Lo que se blinda es el CABLEADO, que es
donde se rompen estas cosas: que la config llegue de verdad a la herramienta,
que internet no se ofrezca cuando está apagado, y que el suelo de años de
Ajustes no le impida al agente ir a buscar algo antiguo a propósito.
"""

import pytest

from app.services.ai import native_tools as nt
from app.services.ai.research_config import ResearchConfig
from app.services.jw.jw_org import JwResult
from app.services.jw.wol_library import SearchResult


class TestCatalogoDeHerramientas:
    def test_sin_internet_no_se_ofrece_la_herramienta_de_internet(self):
        # Una herramienta apagada que aparece en la lista es una llamada
        # perdida por ronda y un error en el rastro de actividad.
        nombres = [t["function"]["name"] for t in nt.tools_for(ResearchConfig.offline())]

        assert "buscar_en_internet" not in nombres
        assert "buscar_en_jw_org" in nombres

    def test_con_internet_si(self):
        nombres = [t["function"]["name"] for t in nt.tools_for(ResearchConfig(internet=True))]

        assert "buscar_en_internet" in nombres

    def test_sin_config_es_el_catalogo_minimo(self):
        nombres = [t["function"]["name"] for t in nt.tools_for(None)]

        assert "buscar_en_internet" not in nombres

    def test_las_dos_busquedas_admiten_fechas(self):
        for nombre in ("buscar_en_biblioteca", "buscar_en_jw_org"):
            tool = next(t for t in nt.NATIVE_TOOLS if t["function"]["name"] == nombre)
            props = tool["function"]["parameters"]["properties"]

            assert {"orden", "desde_anio", "hasta_anio"} <= set(props)


class TestRango:
    def test_el_suelo_de_ajustes_se_aplica_si_el_modelo_no_pide_nada(self):
        desde, hasta = nt._rango({}, ResearchConfig(min_year=2015))

        assert (desde, hasta) == (2015, None)

    def test_lo_que_pide_el_modelo_manda_sobre_el_suelo_de_ajustes(self):
        # Si no, el agente nunca podría ir a buscar un artículo antiguo a
        # propósito, que es justo lo que hay que hacer para comparar
        # entendimientos entre épocas.
        desde, hasta = nt._rango({"hasta_anio": 1990}, ResearchConfig(min_year=2015))

        assert (desde, hasta) == (None, 1990)

    def test_los_limites_al_reves_se_enderezan(self):
        # El modelo a veces los intercambia. Al revés no pasa nada y el agente
        # concluye que no hay material: la conclusión falsa más cara.
        desde, hasta = nt._rango(
            {"desde_anio": 2020, "hasta_anio": 2010}, ResearchConfig()
        )

        assert (desde, hasta) == (2010, 2020)

    def test_los_anos_imposibles_se_ignoran(self):
        assert nt._rango({"desde_anio": "ayer"}, ResearchConfig()) == (None, None)


class TestAvisosDeFecha:
    def _payload(self):
        return {
            "titulo": "x",
            "aviso_fecha": "es viejo",
            "resultados": [{"anio": 1990, "aviso_fecha": "es viejo"}],
        }

    def test_activados_se_quedan(self):
        limpio = nt._sin_avisos(self._payload(), ResearchConfig(date_warnings=True))

        assert "aviso_fecha" in limpio
        assert "aviso_fecha" in limpio["resultados"][0]

    def test_desactivados_se_quitan_pero_el_ano_se_queda(self):
        # Quitar el aviso es decir "no me des la lata", no "ocúltame la fecha".
        limpio = nt._sin_avisos(self._payload(), ResearchConfig(date_warnings=False))

        assert "aviso_fecha" not in limpio
        assert "aviso_fecha" not in limpio["resultados"][0]
        assert limpio["resultados"][0]["anio"] == 1990


class TestBuscarEnBiblioteca:
    def test_pasa_orden_y_rango_al_buscador(self, monkeypatch):
        capturado = {}

        def _fake(consulta, limit, sort, since, until):
            capturado.update(locals())
            return [SearchResult(1, "w20 - La Atalaya 2020", "s", "w20", "u")]

        monkeypatch.setattr(nt, "search_library", _fake)

        nt.call_native_tool(
            "buscar_en_biblioteca",
            {"consulta": "aguante", "orden": "reciente", "desde_anio": 2015},
            ResearchConfig(),
        )

        assert capturado["sort"] == "reciente"
        assert capturado["since"] == 2015

    def test_sin_resultados_con_filtro_lo_dice(self, monkeypatch):
        monkeypatch.setattr(nt, "search_library", lambda *a, **k: [])

        salida = nt.call_native_tool(
            "buscar_en_biblioteca",
            {"consulta": "x", "desde_anio": 2020},
            ResearchConfig(),
        )

        assert salida["resultados"] == []
        assert "ampliar el rango" in salida["aviso"]

    def test_sin_consulta_devuelve_error_y_no_lanza(self):
        assert "error" in nt.call_native_tool("buscar_en_biblioteca", {}, ResearchConfig())


class TestBuscarEnJwOrg:
    def test_traduce_el_tipo_al_de_la_api(self, monkeypatch):
        capturado = {}

        def _fake(consulta, kind, limit, sort, since, until):
            capturado.update(locals())
            return []

        monkeypatch.setattr(nt, "search_jw_org", _fake)

        nt.call_native_tool(
            "buscar_en_jw_org", {"consulta": "x", "tipo": "videos"}, ResearchConfig()
        )

        assert capturado["kind"] == "videos"

    def test_un_tipo_desconocido_degrada_a_todo(self, monkeypatch):
        capturado = {}
        monkeypatch.setattr(
            nt,
            "search_jw_org",
            lambda consulta, kind, limit, sort, since, until: capturado.update(kind=kind) or [],
        )

        nt.call_native_tool(
            "buscar_en_jw_org", {"consulta": "x", "tipo": "loquesea"}, ResearchConfig()
        )

        assert capturado["kind"] == "all"

    def test_con_videos_recuerda_que_hay_que_abrirlos(self, monkeypatch):
        # El agente tiende a citar el vídeo por el título y quedarse ahí.
        monkeypatch.setattr(
            nt,
            "search_jw_org",
            lambda *a, **k: [
                JwResult("pub-x_VIDEO", "video", "Un vídeo", "frag", "ctx", "url")
            ],
        )

        salida = nt.call_native_tool("buscar_en_jw_org", {"consulta": "x"}, ResearchConfig())

        assert "abrir_video" in salida["siguiente_paso"]

    def test_sin_videos_no_hay_recordatorio(self, monkeypatch):
        monkeypatch.setattr(
            nt,
            "search_jw_org",
            lambda *a, **k: [JwResult("pa-1", "article", "Un artículo", "f", "c", "u")],
        )

        salida = nt.call_native_tool("buscar_en_jw_org", {"consulta": "x"}, ResearchConfig())

        assert "siguiente_paso" not in salida


class TestBuscarEnInternet:
    def test_apagado_devuelve_error_accionable(self):
        salida = nt.call_native_tool(
            "buscar_en_internet", {"consulta": "x"}, ResearchConfig.offline()
        )

        assert "Ajustes" in salida["error"]

    def test_sin_config_esta_apagado(self):
        # El default de la firma es "sin internet": una llamada sin config no
        # puede abrir la puerta por descuido.
        salida = nt.call_native_tool("buscar_en_internet", {"consulta": "x"})

        assert "error" in salida


class TestTolerancia:
    def test_una_herramienta_desconocida_no_lanza(self):
        assert "error" in nt.call_native_tool("no_existe", {}, ResearchConfig())

    def test_una_excepcion_dentro_se_convierte_en_error(self, monkeypatch):
        # El chat nunca debe caerse por una tool.
        def _revienta(*a, **k):
            raise RuntimeError("boom")

        monkeypatch.setattr(nt, "search_library", _revienta)

        salida = nt.call_native_tool(
            "buscar_en_biblioteca", {"consulta": "x"}, ResearchConfig()
        )

        assert "error" in salida
