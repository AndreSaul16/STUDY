"""
Tests de la configuración del chat.

Cubren exactamente el fallo que tuvo tumbado el chat en producción:
``OPENAI_REASONING_EFFORT=max`` es un valor que la API rechaza con 400, y como
se pasaba tal cual, TODAS las respuestas fallaban. Ahora un valor inválido
degrada a 'none' en vez de romper, y las rondas con herramientas van siempre
con 'none' (la API no admite otra cosa junto a `tools`).
"""

import importlib

import pytest


def _reload_chat_service(monkeypatch, **env):
    """Reimporta chat_service con el entorno dado (lee las env en import time)."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key-not-real")
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    import app.services.ai.chat_service as chat_service

    return importlib.reload(chat_service)


class TestReasoningEffort:
    def test_un_valor_invalido_degrada_a_none_en_vez_de_romper(self, monkeypatch):
        module = _reload_chat_service(monkeypatch, OPENAI_REASONING_EFFORT="max")

        assert module.OPENAI_REASONING_EFFORT == "none"

    @pytest.mark.parametrize("effort", ["none", "low", "medium", "high", "xhigh"])
    def test_los_valores_admitidos_se_respetan(self, monkeypatch, effort):
        module = _reload_chat_service(monkeypatch, OPENAI_REASONING_EFFORT=effort)

        assert module.OPENAI_REASONING_EFFORT == effort

    def test_las_rondas_con_herramientas_van_siempre_con_none(self, monkeypatch):
        # La API: "Function tools with reasoning_effort are not supported ...
        # set reasoning_effort to 'none'". Aunque se configure 'high'.
        module = _reload_chat_service(monkeypatch, OPENAI_REASONING_EFFORT="high")

        assert module._TOOL_PARAMS == {"reasoning_effort": "none"}
        assert module._ANSWER_PARAMS == {"reasoning_effort": "high"}

    def test_vacio_significa_no_enviar_el_parametro(self, monkeypatch):
        # Los modelos clásicos (gpt-4o-mini) no aceptan reasoning_effort.
        module = _reload_chat_service(monkeypatch, OPENAI_REASONING_EFFORT="")

        assert module._TOOL_PARAMS == {}
        assert module._ANSWER_PARAMS == {}

    def test_se_normalizan_mayusculas_y_espacios(self, monkeypatch):
        module = _reload_chat_service(monkeypatch, OPENAI_REASONING_EFFORT="  HIGH ")

        assert module.OPENAI_REASONING_EFFORT == "high"


class TestHerramientasNativas:
    def test_las_nativas_estan_siempre_disponibles(self):
        from app.services.ai.native_tools import NATIVE_TOOLS, is_native_tool

        nombres = {t["function"]["name"] for t in NATIVE_TOOLS}

        assert "leer_pasaje_biblico" in nombres
        assert "buscar_en_biblioteca" in nombres
        assert is_native_tool("abrir_documento")
        assert not is_native_tool("get_verse_with_study")  # esa es del MCP

    def test_una_herramienta_desconocida_devuelve_error_sin_lanzar(self):
        from app.services.ai.native_tools import call_native_tool

        result = call_native_tool("no_existe", {})

        assert "error" in result

    def test_los_argumentos_invalidos_devuelven_error_sin_lanzar(self):
        # Que el modelo mande basura no puede tumbar el stream del chat.
        from app.services.ai.native_tools import call_native_tool

        assert "error" in call_native_tool("leer_pasaje_biblico", {})
        assert "error" in call_native_tool("leer_pasaje_biblico", {"libro": "Juan", "capitulo": "x"})
        assert "error" in call_native_tool("abrir_documento", {"doc_id": "no-es-un-numero"})
        assert "error" in call_native_tool("buscar_en_biblioteca", {"consulta": "  "})


class TestResolucionDelBinarioMcp:
    def test_una_ruta_absoluta_inexistente_cae_al_binario_del_path(self, monkeypatch, tmp_path):
        # JW_MCP_PATH apuntaba al shim de pnpm en WSL; dentro del contenedor esa
        # ruta no existe y el bridge moría con FileNotFoundError.
        from app.services.ai import mcp_bridge

        falso = tmp_path / "jw-mcp"
        falso.write_text("#!/bin/sh\n")
        falso.chmod(0o755)
        monkeypatch.setattr(mcp_bridge.shutil, "which", lambda _: str(falso))

        resuelto = mcp_bridge._resolve_mcp_command("/ruta/que/no/existe/jw-mcp")

        assert resuelto == str(falso)

    def test_sin_configurar_usa_el_nombre_del_binario(self):
        from app.services.ai.mcp_bridge import _resolve_mcp_command

        assert _resolve_mcp_command(None) == "jw-mcp"
        assert _resolve_mcp_command("  ") == "jw-mcp"
