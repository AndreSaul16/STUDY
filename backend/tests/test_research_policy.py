"""
Tests de la política de investigación.

El system prompt PIDE investigar; estas reglas COMPRUEBAN que lo hizo. Todo son
funciones puras: sin red, sin API key, sin reloj real.
"""

import pytest

from app.services.ai.chat_modes import CHAT_MODES, get_mode
from app.services.ai.research_policy import (
    budget_exhausted,
    compact_tool_results,
    executed_tool_names,
    research_gap,
    research_tokens,
    tool_cache_key,
)


def _assistant_call(name: str, arguments: str = "{}") -> dict:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": name, "arguments": arguments}}
        ],
    }


class TestExecutedToolNames:
    def test_extrae_los_nombres_en_orden(self):
        messages = [
            {"role": "system", "content": "…"},
            {"role": "user", "content": "hola"},
            _assistant_call("buscar_en_biblioteca"),
            {"role": "tool", "tool_call_id": "call_1", "content": "{}"},
            _assistant_call("abrir_documento"),
        ]

        assert executed_tool_names(messages) == [
            "buscar_en_biblioteca",
            "abrir_documento",
        ]

    def test_una_conversacion_sin_herramientas_devuelve_lista_vacia(self):
        assert executed_tool_names([{"role": "user", "content": "hola"}]) == []
        assert executed_tool_names([]) == []

    def test_tolera_formas_malformadas(self):
        messages = [
            "no soy un dict",
            {"role": "assistant", "tool_calls": ["tampoco"]},
            {"role": "assistant", "tool_calls": [{"function": {}}]},
        ]

        assert executed_tool_names(messages) == []


class TestResearchGap:
    def test_sin_ninguna_herramienta_siempre_hay_brecha(self):
        for mode_id in CHAT_MODES:
            gap = research_gap([], get_mode(mode_id))

            assert gap is not None
            assert "No has consultado ninguna fuente" in gap

    def test_buscar_sin_abrir_es_brecha(self):
        # Sigue siendo brecha, pero el aviso ya no es el mismo: con una sola
        # búsqueda en la Biblioteca y nada abierto, lo útil es mandarle al otro
        # catálogo (ver TestUnSoloCatalogo). El aviso de "abre el documento" se
        # reserva para cuando ya ha mirado en los dos sitios.
        gap = research_gap(
            ["buscar_en_biblioteca", "buscar_en_jw_org"], get_mode("analisis")
        )

        assert gap is not None
        assert "abre el más relevante con abrir_documento" in gap

    def test_buscar_y_abrir_basta_para_analisis(self):
        assert (
            research_gap(
                ["buscar_en_biblioteca", "abrir_documento"], get_mode("analisis")
            )
            is None
        )

    @pytest.mark.parametrize("mode_id", ["comentario", "ilustracion", "discurso"])
    def test_las_piezas_de_pulpito_exigen_el_texto_biblico(self, mode_id):
        gap = research_gap(
            ["buscar_en_biblioteca", "abrir_documento"], get_mode(mode_id)
        )

        assert gap is not None
        assert "texto bíblico literal" in gap

    @pytest.mark.parametrize("mode_id", ["comentario", "ilustracion", "discurso"])
    def test_con_el_pasaje_leido_ya_no_hay_brecha(self, mode_id):
        assert (
            research_gap(
                ["buscar_en_biblioteca", "abrir_documento", "leer_pasaje_biblico"],
                get_mode(mode_id),
            )
            is None
        )

    def test_el_equivalente_del_mcp_tambien_cuenta_como_pasaje(self):
        assert (
            research_gap(
                ["buscar_en_biblioteca", "abrir_documento", "get_verse_with_study"],
                get_mode("comentario"),
            )
            is None
        )

    @pytest.mark.parametrize("mode_id", ["analisis", "presentacion"])
    def test_los_modos_que_no_son_de_pulpito_no_exigen_pasaje(self, mode_id):
        assert (
            research_gap(
                ["buscar_en_biblioteca", "abrir_documento"], get_mode(mode_id)
            )
            is None
        )

    def test_leer_solo_el_pasaje_basta_si_no_hubo_busqueda(self):
        # No buscó nada, así que no hay "buscó pero no abrió". Leyó el texto.
        assert research_gap(["leer_pasaje_biblico"], get_mode("comentario")) is None


class TestBudgetExhausted:
    def test_dentro_del_presupuesto(self):
        assert budget_exhausted(started_at=100.0, budget_s=75.0, now=140.0) is False

    def test_justo_en_el_limite_esta_agotado(self):
        assert budget_exhausted(started_at=100.0, budget_s=75.0, now=175.0) is True

    def test_pasado_el_limite(self):
        assert budget_exhausted(started_at=100.0, budget_s=75.0, now=200.0) is True

    def test_un_presupuesto_de_cero_significa_sin_limite(self):
        assert budget_exhausted(started_at=0.0, budget_s=0.0, now=99999.0) is False


class TestToolCacheKey:
    def test_los_mismos_argumentos_dan_la_misma_clave(self):
        a = tool_cache_key("abrir_documento", {"doc_id": 42})
        b = tool_cache_key("abrir_documento", {"doc_id": 42})

        assert a == b

    def test_el_orden_de_las_claves_no_importa(self):
        a = tool_cache_key("leer_pasaje_biblico", {"libro": "Juan", "capitulo": 3})
        b = tool_cache_key("leer_pasaje_biblico", {"capitulo": 3, "libro": "Juan"})

        assert a == b

    def test_argumentos_distintos_dan_claves_distintas(self):
        assert tool_cache_key("abrir_documento", {"doc_id": 1}) != tool_cache_key(
            "abrir_documento", {"doc_id": 2}
        )

    def test_herramientas_distintas_no_colisionan(self):
        assert tool_cache_key("a", {}) != tool_cache_key("b", {})

    def test_tolera_argumentos_que_no_son_dict(self):
        assert tool_cache_key("abrir_documento", None) == "abrir_documento:{}"


class TestUnSoloCatalogo:
    """
    El caso real que se rompía: cuatro búsquedas en la Biblioteca, cero
    resultados cada vez, y el agente rindiéndose sin haber tocado jw.org ni un
    vídeo. Decirle ahí "abre el documento más relevante" es inútil: no había
    ninguno. Se le manda al otro catálogo.
    """

    def test_solo_wol_y_sin_abrir_nada_manda_al_otro_catalogo(self):
        mensajes = [_assistant_call("buscar_en_biblioteca")]

        gap = research_gap(executed_tool_names(mensajes), get_mode("analisis"))

        assert gap is not None
        assert "buscar_en_jw_org" in gap
        assert "abrir_video" in gap

    def test_si_ya_mirO_en_los_dos_el_aviso_es_el_de_abrir_documento(self):
        mensajes = [
            _assistant_call("buscar_en_biblioteca"),
            _assistant_call("buscar_en_jw_org"),
        ]

        gap = research_gap(executed_tool_names(mensajes), get_mode("analisis"))

        assert gap is not None
        assert "abrir_documento" in gap

    def test_abrir_un_video_cuenta_como_haber_abierto_algo(self):
        # Un vídeo con transcripción es contenido citable, igual que un
        # artículo: no puede seguir pidiendo que abra un documento.
        mensajes = [
            _assistant_call("buscar_en_jw_org"),
            _assistant_call("abrir_video"),
        ]

        assert research_gap(executed_tool_names(mensajes), get_mode("analisis")) is None


class TestResearchTokens:
    """
    Lo único que crece sin techo dentro de un turno es lo consultado. Medirlo es
    lo que permite darle al modelo sitio para pensar en proporción a lo que
    tiene que releer antes de redactar.
    """

    def test_solo_cuenta_los_resultados_de_herramienta(self):
        mensajes = [
            {"role": "system", "content": "x" * 4000},
            {"role": "user", "content": "y" * 4000},
            _assistant_call("abrir_documento"),
            {"role": "tool", "tool_call_id": "call_1", "content": "z" * 4000},
        ]

        assert research_tokens(mensajes) == 1000

    def test_sin_investigacion_no_hay_nada_que_reservar(self):
        assert research_tokens([{"role": "user", "content": "hola"}]) == 0

    def test_crece_con_los_documentos(self):
        uno = [{"role": "tool", "content": "a" * 12_000}]
        diez = [{"role": "tool", "content": "a" * 12_000} for _ in range(10)]

        assert research_tokens(diez) == 10 * research_tokens(uno)

    @pytest.mark.parametrize("basura", [None, [], [{"role": "tool"}], ["no soy dict"]])
    def test_la_basura_no_revienta_la_cuenta(self, basura):
        assert research_tokens(basura) == 0


class TestCompactToolResults:
    """
    El recorte del rescate: cuando el modelo cerró el stream sin escribir,
    volver a pedírselo con el mismo material delante le hace pensar otra vez lo
    mismo y acabar igual.
    """

    def test_recorta_los_resultados_grandes(self):
        mensajes = [{"role": "tool", "content": "a" * 12_000}]

        recortado = compact_tool_results(mensajes, 2000)

        assert len(recortado[0]["content"]) < 2200
        assert recortado[0]["content"].startswith("a" * 2000)

    def test_avisa_de_que_esta_cortado(self):
        # Sin la marca, el modelo cita párrafos y páginas como si tuviera el
        # documento entero delante.
        recortado = compact_tool_results([{"role": "tool", "content": "a" * 9000}], 100)

        assert "recortado" in recortado[0]["content"]

    def test_los_resultados_pequenos_pasan_intactos(self):
        # Un versículo o un listado de búsqueda no son el problema.
        mensajes = [{"role": "tool", "tool_call_id": "c1", "content": "Isaías 58:12"}]

        assert compact_tool_results(mensajes, 2000) == mensajes

    def test_no_toca_los_demas_mensajes(self):
        mensajes = [
            {"role": "system", "content": "s" * 9000},
            _assistant_call("abrir_documento"),
            {"role": "user", "content": "u" * 9000},
        ]

        assert compact_tool_results(mensajes, 100) == mensajes

    def test_no_modifica_la_lista_original(self):
        # La primera pasada tiene que poder usarla tal cual.
        original = [{"role": "tool", "tool_call_id": "c1", "content": "a" * 9000}]

        compact_tool_results(original, 100)

        assert len(original[0]["content"]) == 9000

    def test_conserva_el_tool_call_id(self):
        # Sin él, el proveedor no puede casar el resultado con su llamada.
        recortado = compact_tool_results(
            [{"role": "tool", "tool_call_id": "c1", "content": "a" * 9000}], 100
        )

        assert recortado[0]["tool_call_id"] == "c1"
