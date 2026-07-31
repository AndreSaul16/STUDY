"""
Tests de la guía de estilo — los bloques de texto del system prompt.

No comprueban "que el texto exista": comprueban que siguen ahí los marcadores
concretos que definen la voz del usuario. Si alguien reescribe VOICE_GUIDE con
prosa genérica, estos tests se ponen rojos.
"""

import re

import pytest

from app.services.ai.style_guide import (
    CITATION_CONTRACT,
    IDENTITY,
    LANGUAGE_POLICY,
    RESEARCH_POLICY,
    TOOL_CATALOG,
    VOICE_GUIDE,
)

ALL_BLOCKS = {
    "IDENTITY": IDENTITY,
    "RESEARCH_POLICY": RESEARCH_POLICY,
    "LANGUAGE_POLICY": LANGUAGE_POLICY,
    "VOICE_GUIDE": VOICE_GUIDE,
    "CITATION_CONTRACT": CITATION_CONTRACT,
    "TOOL_CATALOG": TOOL_CATALOG,
}

# Rangos de emoji habituales. La prohibición de emojis del prompt sería una
# broma si el propio prompt los usara.
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]"
)


class TestBloquesDelPrompt:
    @pytest.mark.parametrize("name", sorted(ALL_BLOCKS))
    def test_ningun_bloque_esta_vacio(self, name):
        assert ALL_BLOCKS[name].strip(), f"{name} está vacío"

    @pytest.mark.parametrize("name", sorted(ALL_BLOCKS))
    def test_ningun_bloque_contiene_emojis(self, name):
        encontrado = _EMOJI_RE.findall(ALL_BLOCKS[name])

        assert not encontrado, f"{name} contiene emojis: {encontrado}"


class TestVoiceGuide:
    @pytest.mark.parametrize(
        "marcador",
        [
            "ustedes",
            "emojis",
            "Jehová",
            "Salón del Reino",
        ],
    )
    def test_conserva_los_rasgos_de_su_entorno(self, marcador):
        assert marcador.lower() in VOICE_GUIDE.lower()

    def test_prohibe_el_lenguaje_de_coach(self):
        assert "empoderar" in VOICE_GUIDE
        assert "clave del éxito" in VOICE_GUIDE

    def test_exige_entrecomillar_la_expresion_biblica(self):
        assert "entre comillas" in VOICE_GUIDE

    # ─── Lo que de verdad hay que proteger ───────────────────────
    # La primera versión de esta guía listaba los giros literales del usuario
    # ("caso legal", "no tirar la toalla", "¡qué gran lección!") y el modelo los
    # repetía en cada turno: dejaban de ser su voz y sonaban a muletilla. Estos
    # tests impiden que eso vuelva.

    @pytest.mark.parametrize(
        "muletilla",
        [
            "caso legal",
            "fuego ardiente",
            "temible guerrero",
            "no tirar la toalla",
            "qué gran lección",
            "pincho USB",
            "estar de bajón",
            "parejita",
        ],
    )
    def test_no_ofrece_frases_suyas_para_copiar(self, muletilla):
        assert muletilla.lower() not in VOICE_GUIDE.lower(), (
            f"«{muletilla}» es un giro concreto del usuario. En el prompt se "
            "convierte en muletilla: descríbase el instinto, no la frase."
        )

    def test_prohibe_explicitamente_copiar_expresiones(self):
        texto = VOICE_GUIDE.lower()

        assert "no copies expresiones" in texto

    def test_prohibe_presentar_lo_que_entrega(self):
        # "Aquí tienes una propuesta de unas 75 palabras…" era literal en el
        # prompt viejo y salía en todas las respuestas.
        assert "aquí tienes una propuesta" in VOICE_GUIDE.lower()
        assert "nada de" in VOICE_GUIDE.lower()

    def test_pide_hablar_como_una_persona_normal(self):
        assert "como una persona normal" in VOICE_GUIDE.lower()


class TestPoliticaDeInvestigacion:
    def test_mantiene_la_prohibicion_de_responder_sin_fuentes(self):
        # Esta frase es el contrato: el resto del plan la da por cierta.
        assert (
            "Está PROHIBIDO responder sin haber consultado las"
            in RESEARCH_POLICY
        )

    def test_exige_abrir_el_documento_y_no_solo_buscar(self):
        assert "abrir_documento" in RESEARCH_POLICY
        assert "un fragmento de búsqueda NO basta" in RESEARCH_POLICY


class TestContratoDeCitas:
    def test_fija_el_formato_que_el_frontend_sabe_detectar(self):
        assert "Isaías 58:12" in CITATION_CONTRACT
        assert "1 Corintios 9:26" in CITATION_CONTRACT

    def test_prohibe_inventar_paginas_y_pegar_urls(self):
        assert "No inventes números de página" in CITATION_CONTRACT
        assert "No pegues URLs" in CITATION_CONTRACT
