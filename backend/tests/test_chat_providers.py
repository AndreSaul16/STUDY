"""
Tests de la capa de proveedor del chat.

Ni una llamada de red ni una key real: todo lo que decide comportamiento
(``get_provider``, ``normalize_effort``, ``effort_params``, ``tool_choice_for``)
son funciones puras, y ``build_runtime`` solo construye un cliente del SDK sin
usarlo.

El test que de verdad importa aquí es el último: que la key NO aparezca en el
``repr()`` del runtime. Un ``logger.debug("%s", runtime)` en un rato de prisa
la habría dejado en los logs de Railway para siempre.
"""

import pytest

from app.services.ai.chat_providers import (
    DEFAULT_EFFORT,
    EFFORT_IDS,
    GOOGLE,
    OPENAI,
    PROVIDERS,
    build_runtime,
    effort_params,
    get_provider,
    has_server_key,
    is_usable_key,
    native_effort,
    normalize_effort,
    server_runtime,
    tool_choice_for,
)

FAKE_OPENAI_KEY = "sk-testtesttesttesttesttesttest"
FAKE_GOOGLE_KEY = "AIzaTESTTESTTESTTESTTESTTESTTEST"


class TestGetProvider:
    @pytest.mark.parametrize("value", [None, "", "   ", "desconocido", "azure"])
    def test_lo_que_no_se_reconoce_degrada_a_openai(self, value):
        # Un 422 aquí rompería el chat de un cliente antiguo sin ganar nada.
        assert get_provider(value) is OPENAI

    @pytest.mark.parametrize("value", ["google", "GOOGLE ", " Google"])
    def test_se_normalizan_mayusculas_y_espacios(self, value):
        assert get_provider(value) is GOOGLE

    def test_los_proveedores_estan_registrados(self):
        assert set(PROVIDERS) == {"openai", "google", "minimax"}


class TestNormalizeEffort:
    @pytest.mark.parametrize("spec", [OPENAI, GOOGLE])
    @pytest.mark.parametrize("effort", EFFORT_IDS)
    def test_los_cinco_ids_se_respetan_en_ambos_proveedores(self, spec, effort):
        assert normalize_effort(spec, effort) == effort

    @pytest.mark.parametrize("spec", [OPENAI, GOOGLE])
    @pytest.mark.parametrize("basura", ["max", "turbo", "42", "???"])
    def test_la_basura_degrada_en_vez_de_romper(self, spec, basura):
        assert normalize_effort(spec, basura) == DEFAULT_EFFORT

    @pytest.mark.parametrize("spec", [OPENAI, GOOGLE])
    @pytest.mark.parametrize("vacio", [None, "", "   "])
    def test_vacio_significa_no_mandar_el_parametro(self, spec, vacio):
        assert normalize_effort(spec, vacio) == ""

    def test_se_aceptan_los_nombres_nativos_del_entorno_del_servidor(self):
        # OPENAI_REASONING_EFFORT=high lleva años configurado así.
        assert normalize_effort(OPENAI, "high") == "alto"
        assert normalize_effort(OPENAI, "xhigh") == "maximo"
        assert normalize_effort(GOOGLE, "minimal") == "ninguno"

    def test_maximo_en_google_se_aplica_como_high(self):
        # Gemini no tiene un escalón por encima de "high": se degrada y se
        # informa por metadata, no se falla.
        assert normalize_effort(GOOGLE, "maximo") == "maximo"
        assert native_effort(GOOGLE, "maximo") == "high"

    def test_ninguno_en_google_se_aplica_como_minimal(self):
        # Gemini 3 no apaga el pensamiento del todo: no existe "none".
        assert native_effort(GOOGLE, "ninguno") == "minimal"
        assert native_effort(OPENAI, "ninguno") == "none"


class TestEffortParams:
    def test_openai_reserva_el_esfuerzo_para_la_ronda_sin_tools(self):
        # La API: "Function tools with reasoning_effort are not supported ...
        # set reasoning_effort to 'none'".
        assert effort_params(OPENAI, "alto") == (
            {"reasoning_effort": "none"},
            {"reasoning_effort": "high"},
        )

    def test_google_no_manda_esfuerzo_en_las_rondas_con_tools(self):
        # Antes iba "minimal", que es vocabulario NATIVO de Gemini y no está en
        # el enum de su capa de compatibilidad (none/low/medium/high). El
        # parámetro solo existe por una restricción de OpenAI que no aplica a
        # Google, así que se dejó de mandar: era arriesgar por nada, y una
        # ronda de tools que devuelve 400 tumba la conversación entera.
        assert effort_params(GOOGLE, "ninguno") == ({}, {"reasoning_effort": "minimal"})
        assert effort_params(GOOGLE, "alto") == ({}, {"reasoning_effort": "high"})

    def test_el_esfuerzo_del_usuario_sigue_llegando_a_la_ronda_final(self):
        # Quitar el parámetro de las rondas con tools no puede costarle al
        # usuario el esfuerzo que eligió: la redacción es donde se nota.
        _, respuesta = effort_params(GOOGLE, "maximo")

        assert respuesta == {"reasoning_effort": "high"}

    @pytest.mark.parametrize("spec", [OPENAI, GOOGLE])
    def test_vacio_no_manda_el_parametro_en_ninguna_ronda(self, spec):
        # Los modelos clásicos (gpt-4o-mini) lo rechazan de plano.
        assert effort_params(spec, "") == ({}, {})


class TestToolChoice:
    def test_openai_admite_required(self):
        assert tool_choice_for(OPENAI, force=True) == "required"

    def test_google_degrada_a_auto(self):
        # Capacidad, no suposición: la doc de Google solo ejemplifica "auto".
        assert tool_choice_for(GOOGLE, force=True) == "auto"

    @pytest.mark.parametrize("spec", [OPENAI, GOOGLE])
    def test_sin_forzar_siempre_es_auto(self, spec):
        assert tool_choice_for(spec, force=False) == "auto"


class TestIsUsableKey:
    @pytest.mark.parametrize("value", [None, "", "   ", "sk-your-api-key-here"])
    def test_el_placeholder_del_env_example_no_es_una_key(self, value):
        assert is_usable_key(value) is False

    def test_una_key_de_verdad_si(self):
        assert is_usable_key(FAKE_OPENAI_KEY) is True


class TestBuildRuntime:
    def test_google_apunta_a_la_capa_de_compatibilidad(self):
        runtime = build_runtime("google", FAKE_GOOGLE_KEY, effort="alto")

        assert runtime.provider is GOOGLE
        assert str(runtime.client.base_url).startswith(
            "https://generativelanguage.googleapis.com/v1beta/openai"
        )
        assert runtime.model == GOOGLE.default_model
        assert runtime.effort_applied == "high"

    def test_openai_usa_el_base_url_del_sdk(self):
        runtime = build_runtime("openai", FAKE_OPENAI_KEY, model="gpt-5.6-luna")

        assert "api.openai.com" in str(runtime.client.base_url)
        assert runtime.model == "gpt-5.6-luna"

    @pytest.mark.parametrize("provider", ["openai", "google"])
    def test_la_key_no_aparece_en_el_repr_del_runtime(self, provider):
        key = FAKE_OPENAI_KEY if provider == "openai" else FAKE_GOOGLE_KEY
        runtime = build_runtime(provider, key)

        assert key not in repr(runtime)
        assert key not in str(runtime.metadata())

    def test_la_metadata_no_lleva_la_key(self):
        meta = build_runtime("openai", FAKE_OPENAI_KEY, effort="alto").metadata()

        assert meta == {
            "provider": "openai",
            "model": OPENAI.default_model,
            "effort": "alto",
            "effort_applied": "high",
            "source": "client",
        }

    def test_un_proveedor_desconocido_no_lanza(self):
        runtime = build_runtime("inventado", FAKE_OPENAI_KEY)

        assert runtime.provider is OPENAI


class TestServerRuntime:
    def test_sin_key_en_el_entorno_no_hay_runtime_de_servidor(self, monkeypatch):
        for var in ("OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.delenv("CHAT_PROVIDER", raising=False)

        assert server_runtime() is None
        assert has_server_key() is False

    def test_con_key_en_el_entorno_se_conserva_el_modelo_de_siempre(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_OPENAI_KEY)
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
        monkeypatch.setenv("OPENAI_REASONING_EFFORT", "")
        monkeypatch.delenv("CHAT_PROVIDER", raising=False)

        runtime = server_runtime()

        assert runtime is not None
        assert runtime.source == "server"
        assert runtime.model == "gpt-4o-mini"
        # Modelo clásico: sin reasoning_effort en ninguna ronda.
        assert runtime.tool_params == {}
        assert runtime.answer_params == {}

    def test_el_placeholder_del_env_example_no_cuenta_como_key(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-your-api-key-here")
        monkeypatch.delenv("CHAT_PROVIDER", raising=False)

        assert server_runtime() is None
