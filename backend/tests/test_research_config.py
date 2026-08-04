"""
Tests de la configuración de investigación y del limpiador de razonamiento.

Dos piezas pequeñas de las que depende bastante:

  * ``ResearchConfig`` decide si el agente sale a internet y si el filtro
    doctrinal está puesto. Tiene que degradar sin lanzar ante cualquier basura
    del cliente, y venir ACTIVADA por defecto.
  * ``ReasoningStripper`` quita el ``<think>`` que MiniMax mete dentro del
    contenido. Se prueba TROCEANDO el texto, que es como llega de verdad.
"""

import pytest

from app.services.ai.chat_providers import GOOGLE, MINIMAX, OPENAI, ReasoningStripper
from app.services.ai.research_config import ResearchConfig


class TestValoresPorDefecto:
    def test_todo_viene_activado(self):
        # La configuración por defecto tiene que ser la buena, no la mínima.
        config = ResearchConfig()

        assert config.internet is True
        assert config.doctrinal_filter is True
        assert config.date_warnings is True
        assert config.scope == "cientifico"

    def test_offline_apaga_solo_internet(self):
        config = ResearchConfig.offline()

        assert config.internet is False
        assert config.doctrinal_filter is True
        assert config.date_warnings is True

    def test_sin_payload_son_los_defaults(self):
        assert ResearchConfig.from_payload(None) == ResearchConfig()


class TestFromPayload:
    @pytest.mark.parametrize(
        "valor,esperado",
        [
            (True, True), (False, False),
            ("true", True), ("false", False),
            ("1", True), ("0", False),
            ("si", True), ("no", False),
            (None, True),          # ausente → default
            ("cualquier cosa", True),  # ilegible → default
        ],
    )
    def test_los_booleanos_son_tolerantes(self, valor, esperado):
        assert ResearchConfig.from_payload({"internet": valor}).internet is esperado

    def test_un_scope_desconocido_degrada(self):
        assert ResearchConfig.from_payload({"scope": "loquesea"}).scope == "cientifico"

    def test_ampliado_se_respeta(self):
        config = ResearchConfig.from_payload({"scope": "ampliado"})

        assert config.scope == "ampliado"
        assert config.allows_general_web is True

    def test_ampliado_con_internet_apagado_no_permite_web(self):
        config = ResearchConfig.from_payload({"scope": "ampliado", "internet": False})

        assert config.allows_general_web is False

    @pytest.mark.parametrize("valor", ["muchos", None, "", {}])
    def test_max_results_ilegible_degrada(self, valor):
        assert ResearchConfig.from_payload({"max_results": valor}).max_results == 6

    def test_max_results_se_acota(self):
        assert ResearchConfig.from_payload({"max_results": 500}).max_results == 12
        assert ResearchConfig.from_payload({"max_results": -3}).max_results == 1

    @pytest.mark.parametrize("valor", ["2015", 2015])
    def test_min_year_acepta_texto_y_numero(self, valor):
        assert ResearchConfig.from_payload({"min_year": valor}).min_year == 2015

    @pytest.mark.parametrize("valor", ["ayer", None, ""])
    def test_min_year_ilegible_es_none(self, valor):
        assert ResearchConfig.from_payload({"min_year": valor}).min_year is None

    def test_un_payload_que_no_es_dict_no_revienta(self):
        assert ResearchConfig.from_payload("cadena suelta") == ResearchConfig()
        assert ResearchConfig.from_payload(42) == ResearchConfig()


class TestReasoningStripper:
    def test_desactivado_devuelve_el_texto_tal_cual(self):
        limpiador = ReasoningStripper(enabled=False)

        assert limpiador.feed("<think>ruido</think>hola") == "<think>ruido</think>hola"

    def test_quita_un_bloque_completo(self):
        limpiador = ReasoningStripper(enabled=True)

        assert limpiador.feed("<think>ruido</think>hola") == "hola"
        assert limpiador.flush() == ""

    def test_texto_antes_y_despues_del_bloque(self):
        limpiador = ReasoningStripper(enabled=True)

        assert limpiador.feed("A<think>x</think>B") == "AB"

    def test_la_etiqueta_partida_entre_chunks(self):
        # El caso que obliga a que esto sea un autómata y no un re.sub: el
        # stream trocea donde le da la gana.
        limpiador = ReasoningStripper(enabled=True)
        trozos = ["Ho", "la <thi", "nk>rui", "do</thi", "nk> mundo"]

        salida = "".join(limpiador.feed(t) for t in trozos) + limpiador.flush()

        assert salida == "Hola  mundo"

    def test_un_think_sin_cerrar_se_tira_entero(self):
        limpiador = ReasoningStripper(enabled=True)

        visible = limpiador.feed("hola <think>me quedé pensando")

        assert visible == "hola "
        assert limpiador.flush() == ""

    def test_lo_retenido_por_si_acaso_se_emite_al_cerrar(self):
        # "<" al final podría ser el principio de "<think>"; se retiene. Si el
        # stream acaba ahí, era texto de verdad y hay que soltarlo.
        limpiador = ReasoningStripper(enabled=True)

        assert limpiador.feed("2 <") == "2 "
        assert limpiador.flush() == "<"

    def test_varios_bloques_seguidos(self):
        limpiador = ReasoningStripper(enabled=True)

        assert limpiador.feed("<think>a</think>1<think>b</think>2") == "12"

    def test_texto_sin_bloques_pasa_intacto(self):
        limpiador = ReasoningStripper(enabled=True)

        salida = limpiador.feed("Un comentario normal.") + limpiador.flush()

        assert salida == "Un comentario normal."


class TestInlineReasoningPorProveedor:
    def test_solo_minimax_lo_necesita(self):
        # Verificado en vivo: MiniMax mete <think> en content SIEMPRE; OpenAI
        # y Google no.
        assert MINIMAX.inline_reasoning is True
        assert OPENAI.inline_reasoning is False
        assert GOOGLE.inline_reasoning is False
