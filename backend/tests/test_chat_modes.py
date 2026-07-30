"""
Tests de los modos de redacción del chat y de la composición del system prompt.

Sin red y sin OPENAI_API_KEY: todo lo que se prueba aquí son funciones puras.
"""

import pytest

from app.services.ai.chat_modes import (
    CHAT_MODES,
    DEFAULT_MODE,
    ModeSpec,
    get_mode,
    list_modes,
)


class TestGetMode:
    def test_sin_modo_devuelve_el_por_defecto(self):
        assert get_mode(None) is CHAT_MODES[DEFAULT_MODE]
        assert get_mode("") is CHAT_MODES[DEFAULT_MODE]

    def test_un_modo_desconocido_degrada_sin_lanzar(self):
        # El dist desplegado no manda `mode`, y un cliente futuro puede mandar
        # uno que este backend no conoce. Nunca debe ser un error.
        assert get_mode("no_existe") is CHAT_MODES[DEFAULT_MODE]

    def test_normaliza_mayusculas_y_espacios(self):
        assert get_mode("  COMENTARIO ").id == "comentario"

    @pytest.mark.parametrize("mode_id", sorted(CHAT_MODES))
    def test_cada_modo_se_resuelve_a_si_mismo(self, mode_id):
        assert get_mode(mode_id).id == mode_id


class TestModeSpecs:
    def test_hay_cinco_modos(self):
        assert set(CHAT_MODES) == {
            "analisis",
            "comentario",
            "ilustracion",
            "discurso",
            "presentacion",
        }

    @pytest.mark.parametrize("mode_id", sorted(CHAT_MODES))
    def test_invariantes_de_cada_modo(self, mode_id):
        spec: ModeSpec = CHAT_MODES[mode_id]

        assert spec.id == mode_id
        assert spec.label.strip()
        assert spec.hint.strip()
        assert spec.prompt.strip()
        assert spec.max_tokens > 0
        assert spec.min_tool_rounds >= 1
        assert spec.followups
        assert spec.examples

    def test_el_comentario_tiene_el_techo_de_tokens_mas_bajo(self):
        # 75 palabras no necesitan 2200 tokens; el techo es parte del contrato.
        assert CHAT_MODES["comentario"].max_tokens < CHAT_MODES["analisis"].max_tokens
        assert CHAT_MODES["discurso"].max_tokens > CHAT_MODES["analisis"].max_tokens


class TestListModes:
    def test_devuelve_dicts_serializables_con_las_claves_del_contrato(self):
        modes = list_modes()

        assert len(modes) == len(CHAT_MODES)
        for entry in modes:
            assert set(entry) == {"id", "label", "hint", "examples"}
            assert isinstance(entry["examples"], list)

    def test_el_prompt_no_viaja_al_cliente(self):
        # Es instrucción interna: exponerlo regala el formato y no aporta nada.
        for entry in list_modes():
            assert "prompt" not in entry


class TestPlantillaDelComentario:
    def test_fija_la_longitud_del_comentario(self):
        assert "60 A 80 PALABRAS" in CHAT_MODES["comentario"].prompt

    def test_fija_la_seccion_de_por_que_funciona(self):
        prompt = CHAT_MODES["comentario"].prompt

        assert "Por qué funciona" in prompt
        assert "EXACTAMENTE tres viñetas" in prompt

    def test_exige_la_expresion_biblica_entrecomillada(self):
        assert "EXPRESIÓN BÍBLICA TEXTUAL ENTRECOMILLADA" in CHAT_MODES["comentario"].prompt


class TestSystemPrompt:
    def test_el_prompt_de_un_modo_lleva_su_plantilla_y_no_la_de_otro(self):
        from app.services.ai.chat_service import build_system_prompt

        prompt = build_system_prompt(get_mode("comentario"))

        assert "60 A 80 PALABRAS" in prompt
        assert "MODO: DISCURSO" not in prompt

    @pytest.mark.parametrize("mode_id", sorted(CHAT_MODES))
    def test_todos_los_modos_llevan_la_voz_del_usuario(self, mode_id):
        from app.services.ai.chat_service import build_system_prompt
        from app.services.ai.style_guide import VOICE_GUIDE

        prompt = build_system_prompt(get_mode(mode_id))

        assert VOICE_GUIDE in prompt
        assert "NADA de emojis" in prompt

    @pytest.mark.parametrize("mode_id", sorted(CHAT_MODES))
    def test_todos_los_modos_llevan_la_politica_de_investigacion(self, mode_id):
        from app.services.ai.chat_service import build_system_prompt

        prompt = build_system_prompt(get_mode(mode_id))

        assert "Está PROHIBIDO responder sin haber consultado las" in prompt

    def test_el_alias_de_modulo_es_el_modo_por_defecto(self):
        from app.services.ai.chat_service import SYSTEM_PROMPT, build_system_prompt

        assert SYSTEM_PROMPT == build_system_prompt(get_mode(None))


class TestFollowups:
    """Parseo de las sugerencias: el modelo devuelve JSON… casi siempre."""

    FALLBACK = ("uno", "dos", "tres")

    def test_json_valido(self):
        from app.services.ai.chat_service import parse_followups

        raw = '["¿Y en el ministerio?", "Dame una ilustración", "¿Qué versículo lo apoya?"]'

        assert parse_followups(raw, self.FALLBACK) == [
            "¿Y en el ministerio?",
            "Dame una ilustración",
            "¿Qué versículo lo apoya?",
        ]

    def test_json_dentro_de_una_valla_de_markdown(self):
        from app.services.ai.chat_service import parse_followups

        raw = '```json\n["a", "b", "c"]\n```'

        assert parse_followups(raw, self.FALLBACK) == ["a", "b", "c"]

    def test_json_invalido_cae_al_respaldo(self):
        from app.services.ai.chat_service import parse_followups

        assert parse_followups("no soy json", self.FALLBACK) == list(self.FALLBACK)

    def test_una_lista_de_cinco_se_recorta_a_tres(self):
        from app.services.ai.chat_service import parse_followups

        raw = '["a", "b", "c", "d", "e"]'

        assert parse_followups(raw, self.FALLBACK) == ["a", "b", "c"]

    def test_una_lista_vacia_cae_al_respaldo(self):
        from app.services.ai.chat_service import parse_followups

        assert parse_followups("[]", self.FALLBACK) == list(self.FALLBACK)

    def test_ignora_los_elementos_que_no_son_texto(self):
        from app.services.ai.chat_service import parse_followups

        raw = '["a", 3, null, "  ", "b"]'

        assert parse_followups(raw, self.FALLBACK) == ["a", "b"]

    def test_un_objeto_json_cae_al_respaldo(self):
        from app.services.ai.chat_service import parse_followups

        assert parse_followups('{"items": ["a"]}', self.FALLBACK) == list(self.FALLBACK)
