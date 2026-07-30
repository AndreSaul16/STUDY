"""
Tests del saneado de secretos.

La app es BYOK y el backend no persiste la key, pero los logs de Railway son
visibles y persisten: una key que se cuele en un ``logger.exception`` se queda
ahí. Esta tabla de casos cubre las formas reales en las que se cuela — casi
siempre dentro del mensaje de error del proveedor, no en un log escrito a mano.
"""

import pytest

from app.services.ai.redaction import contains_secret, redact

OPENAI_KEY = "sk-proj-AbCdEf0123456789AbCdEf0123456789"
GOOGLE_KEY = "AIzaSyA0123456789abcdefghijklmnopqrstu"


class TestRedact:
    def test_una_key_de_openai_desaparece(self):
        salida = redact(f"401 Incorrect API key provided: {OPENAI_KEY}")

        assert OPENAI_KEY not in salida
        assert "***" in salida

    def test_una_key_de_google_desaparece(self):
        salida = redact(f"API key not valid: {GOOGLE_KEY}")

        assert GOOGLE_KEY not in salida
        assert "***" in salida

    def test_una_cabecera_authorization_ecoada_desaparece(self):
        salida = redact(f"headers: {{'Authorization': 'Bearer {OPENAI_KEY}'}}")

        assert OPENAI_KEY not in salida

    def test_varias_keys_en_el_mismo_texto(self):
        salida = redact(f"{OPENAI_KEY} y {GOOGLE_KEY}")

        assert not contains_secret(salida)

    def test_una_excepcion_se_acepta_tal_cual(self):
        # Es el caso real: logger.error("...: %s", redact(exc)).
        salida = redact(ValueError(f"bad key {OPENAI_KEY}"))

        assert OPENAI_KEY not in salida
        assert "bad key" in salida

    @pytest.mark.parametrize("value", [None, "", "sin secretos aquí"])
    def test_lo_que_no_tiene_secretos_pasa_intacto(self, value):
        assert redact(value) == (value or "")

    def test_no_se_cepilla_prosa_que_solo_empieza_por_sk(self):
        # "sk-" suelto en un mensaje no es una key: enmascararlo escondería
        # información útil de depuración.
        assert redact("el prefijo sk- identifica a OpenAI") == (
            "el prefijo sk- identifica a OpenAI"
        )

    def test_none_no_lanza(self):
        assert redact(None) == ""


class TestContainsSecret:
    def test_detecta_ambos_formatos(self):
        assert contains_secret(OPENAI_KEY)
        assert contains_secret(GOOGLE_KEY)

    def test_no_hay_falsos_positivos_en_texto_normal(self):
        assert not contains_secret("gpt-5.6-luna · esfuerzo alto")
