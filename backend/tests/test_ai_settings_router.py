"""
Tests de /api/ai/providers y /api/ai/models.

El invariante que blindan estos tests es de seguridad, no de formato: **ninguna
respuesta de esta API contiene una API key**. La app no tiene autenticación, así
que todo lo que devuelva el backend lo puede leer cualquiera con la URL.
"""

import importlib
import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.ai import model_catalog
from app.services.ai.redaction import contains_secret

ai_settings_module = importlib.import_module("app.routers.ai_settings_router")

FIXTURES = Path(__file__).parent / "fixtures"
FAKE_OPENAI_KEY = "sk-testtesttesttesttesttesttest"
FAKE_GOOGLE_KEY = "AIzaTESTTESTTESTTESTTESTTESTTEST"

_REAL_ASYNC_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def _sin_cache():
    model_catalog.clear_cache()
    yield
    model_catalog.clear_cache()


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(ai_settings_module.router)
    return TestClient(app)


@pytest.fixture()
def transporte(monkeypatch):
    def _install(handler):
        def factory(*args, **kwargs):
            kwargs.pop("timeout", None)
            kwargs.pop("transport", None)
            return _REAL_ASYNC_CLIENT(
                transport=httpx.MockTransport(handler), **kwargs
            )

        monkeypatch.setattr(model_catalog.httpx, "AsyncClient", factory)

    return _install


class TestProviders:
    def test_se_pinta_sin_key_ninguna(self, client, monkeypatch):
        # El selector de proveedor tiene que existir ANTES de que el usuario
        # tenga nada configurado.
        for var in ("OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "MINIMAX_API_KEY"):
            monkeypatch.delenv(var, raising=False)

        payload = client.get("/api/ai/providers").json()

        assert [p["id"] for p in payload["providers"]] == ["openai", "google", "minimax"]
        assert payload["server"]["has_server_key"] is False

    def test_cada_proveedor_trae_sus_cinco_escalones_de_esfuerzo(self, client):
        payload = client.get("/api/ai/providers").json()

        for provider in payload["providers"]:
            assert [e["id"] for e in provider["efforts"]] == [
                "ninguno",
                "bajo",
                "medio",
                "alto",
                "maximo",
            ]

    def test_google_no_ofrece_deep_research(self, client):
        # No permite restringir la búsqueda a wol.jw.org: sería la web abierta.
        payload = client.get("/api/ai/providers").json()
        google = next(p for p in payload["providers"] if p["id"] == "google")

        assert google["supports_deep_research"] is False
        assert google["supports_images"] is True

    def test_has_server_key_es_un_booleano_y_no_la_key(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", FAKE_OPENAI_KEY)

        raw = client.get("/api/ai/providers").text

        assert '"has_server_key":true' in raw.replace(" ", "")
        assert FAKE_OPENAI_KEY not in raw
        # "sk-…" sí sale: es el placeholder del input, no una key.
        assert not contains_secret(raw)


class TestModels:
    def test_la_key_va_en_la_cabecera_y_devuelve_la_lista(self, client, transporte):
        payload = json.loads((FIXTURES / "openai_models.json").read_text("utf-8"))
        vistas = {}

        def handler(request: httpx.Request) -> httpx.Response:
            vistas["auth"] = request.headers.get("authorization")
            return httpx.Response(200, json=payload)

        transporte(handler)

        response = client.post(
            "/api/ai/models",
            json={"provider": "openai", "purpose": "chat"},
            headers={"X-AI-Api-Key": FAKE_OPENAI_KEY},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["source"] == "api"
        assert body["provider"] == "openai"
        assert any(m["id"] == "gpt-5.6-luna" for m in body["models"])
        assert vistas["auth"] == f"Bearer {FAKE_OPENAI_KEY}"

    def test_ninguna_respuesta_devuelve_la_key(self, client, transporte):
        payload = json.loads((FIXTURES / "google_models.json").read_text("utf-8"))
        transporte(lambda request: httpx.Response(200, json=payload))

        raw = client.post(
            "/api/ai/models",
            json={"provider": "google", "purpose": "chat"},
            headers={"X-AI-Api-Key": FAKE_GOOGLE_KEY},
        ).text

        assert FAKE_GOOGLE_KEY not in raw
        assert "AIza" not in raw
        assert "sk-" not in raw

    def test_una_key_invalida_da_401_con_mensaje_propio(self, client, transporte):
        transporte(
            lambda request: httpx.Response(
                401, json={"error": {"message": f"bad key {FAKE_OPENAI_KEY}"}}
            )
        )

        response = client.post(
            "/api/ai/models",
            json={"provider": "openai"},
            headers={"X-AI-Api-Key": FAKE_OPENAI_KEY},
        )

        assert response.status_code == 401
        assert "OpenAI" in response.json()["detail"]
        assert FAKE_OPENAI_KEY not in response.text

    def test_sin_key_devuelve_la_lista_de_respaldo_en_vez_de_fallar(self, client):
        response = client.post("/api/ai/models", json={"provider": "openai"})

        assert response.status_code == 200
        body = response.json()
        assert body["source"] == "fallback"
        assert body["models"]

    def test_un_proveedor_desconocido_degrada_en_vez_de_dar_422(self, client):
        response = client.post("/api/ai/models", json={"provider": "inventado"})

        assert response.status_code == 200
        assert response.json()["provider"] == "openai"

    def test_un_proposito_desconocido_cae_en_chat(self, client):
        response = client.post(
            "/api/ai/models", json={"provider": "openai", "purpose": "loquesea"}
        )

        assert response.json()["purpose"] == "chat"
