"""
Tests de cómo /api/chat/stream resuelve el runtime.

Cubren la compatibilidad, que es lo que se rompe sin enterarse: **sin cabecera
y sin campos nuevos, la petición tiene que comportarse exactamente como antes**
(modo servidor con las env vars de siempre). El cliente ya desplegado en
`frontend/dist` no manda nada de esto.

Y cubren el invariante de seguridad: la key del usuario llega por cabecera, se
usa para construir el runtime y no aparece en ninguna respuesta.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.ai.redaction import contains_secret

chat_router_module = importlib.import_module("app.routers.chat_router")

FAKE_CLIENT_KEY = "sk-clientclientclientclientclient"
FAKE_SERVER_KEY = "sk-serverserverserverserverserver"


class _ServicioFalso:
    """Captura el runtime con el que se le llama. No toca la red."""

    def __init__(self):
        self.mcp_tools = []
        self.tools = []
        self.ultimo_runtime = None

    async def ensure_tools(self):
        return None

    async def chat_stream(self, messages, mode=None, runtime=None):
        self.ultimo_runtime = runtime
        yield 'event: done\ndata: {"total_tokens": 0, "elapsed_ms": 0}\n\n'


@pytest.fixture()
def servicio(monkeypatch):
    fake = _ServicioFalso()
    monkeypatch.setattr(chat_router_module, "get_chat_service", lambda: fake)
    return fake


@pytest.fixture()
def client(monkeypatch, servicio):
    for var in (
        "OPENAI_API_KEY",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "CHAT_PROVIDER",
        "CHAT_REQUIRE_CLIENT_KEY",
        "CHAT_ALLOW_CLIENT_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)

    app = FastAPI()
    app.include_router(chat_router_module.router)
    return TestClient(app)


def _post(client, body=None, headers=None):
    return client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "hola"}], **(body or {})},
        headers=headers or {},
    )


class TestModoServidor:
    def test_sin_cabecera_ni_campos_nuevos_se_usa_el_runtime_del_servidor(
        self, client, servicio, monkeypatch
    ):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_SERVER_KEY)
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")

        assert _post(client).status_code == 200

        runtime = servicio.ultimo_runtime
        assert runtime.source == "server"
        assert runtime.provider.id == "openai"
        assert runtime.model == "gpt-4o-mini"

    def test_sin_key_de_ningun_tipo_es_un_503_accionable(self, client):
        response = _post(client)

        assert response.status_code == 503
        assert "Ajustes" in response.json()["detail"]

    def test_el_modelo_del_cliente_se_respeta_en_modo_servidor(
        self, client, servicio, monkeypatch
    ):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_SERVER_KEY)

        _post(client, {"model": "gpt-5.6-luna", "effort": "alto"})

        assert servicio.ultimo_runtime.model == "gpt-5.6-luna"
        assert servicio.ultimo_runtime.effort == "alto"

    def test_se_puede_desactivar_que_el_cliente_elija_modelo(
        self, client, servicio, monkeypatch
    ):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_SERVER_KEY)
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
        monkeypatch.setenv("CHAT_ALLOW_CLIENT_MODEL", "0")

        _post(client, {"model": "gpt-5.6-luna"})

        assert servicio.ultimo_runtime.model == "gpt-4o-mini"


class TestModoCliente:
    def test_la_key_de_la_cabecera_construye_un_runtime_propio(
        self, client, servicio
    ):
        response = _post(
            client,
            {"provider": "google", "model": "gemini-3.5-flash", "effort": "medio"},
            {"X-AI-Api-Key": FAKE_CLIENT_KEY},
        )

        assert response.status_code == 200
        runtime = servicio.ultimo_runtime
        assert runtime.source == "client"
        assert runtime.provider.id == "google"
        assert runtime.model == "gemini-3.5-flash"
        assert runtime.effort == "medio"

    def test_con_key_de_cliente_no_hace_falta_key_de_servidor(self, client):
        assert _post(client, headers={"X-AI-Api-Key": FAKE_CLIENT_KEY}).status_code == 200

    def test_la_key_no_vuelve_en_la_respuesta(self, client):
        response = _post(client, headers={"X-AI-Api-Key": FAKE_CLIENT_KEY})

        assert FAKE_CLIENT_KEY not in response.text
        assert not contains_secret(response.text)

    def test_un_proveedor_desconocido_degrada_en_vez_de_dar_422(
        self, client, servicio
    ):
        response = _post(
            client,
            {"provider": "inventado", "effort": "loquesea"},
            {"X-AI-Api-Key": FAKE_CLIENT_KEY},
        )

        assert response.status_code == 200
        assert servicio.ultimo_runtime.provider.id == "openai"
        assert servicio.ultimo_runtime.effort == "ninguno"

    def test_una_cabecera_vacia_no_cuenta_como_key(self, client):
        response = _post(client, headers={"X-AI-Api-Key": "   "})

        assert response.status_code == 503


class TestRequireClientKey:
    def test_con_la_bandera_puesta_se_exige_la_key_del_usuario(
        self, client, monkeypatch
    ):
        # Producción: la URL de Railway es pública y sin esto cualquiera que la
        # abra gasta la key del dueño.
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_SERVER_KEY)
        monkeypatch.setenv("CHAT_REQUIRE_CLIENT_KEY", "1")

        response = _post(client)

        assert response.status_code == 428
        assert "Ajustes" in response.json()["detail"]

    def test_con_la_bandera_puesta_la_key_del_usuario_pasa(self, client, monkeypatch):
        monkeypatch.setenv("CHAT_REQUIRE_CLIENT_KEY", "1")

        response = _post(client, headers={"X-AI-Api-Key": FAKE_CLIENT_KEY})

        assert response.status_code == 200


class TestHealth:
    def test_dice_si_hay_key_de_servidor_sin_devolverla(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_SERVER_KEY)

        response = client.get("/api/chat/health")

        assert response.json()["has_server_key"] is True
        assert FAKE_SERVER_KEY not in response.text
        assert not contains_secret(response.text)

    def test_sin_key_de_servidor_lo_dice_sin_romperse(self, client):
        response = client.get("/api/chat/health")

        assert response.status_code == 200
        assert response.json()["has_server_key"] is False
