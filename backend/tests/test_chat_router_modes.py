"""
Tests de GET /api/chat/modes.

El punto del endpoint es que el selector de modos de la interfaz se pinte
SIEMPRE, aunque no haya OPENAI_API_KEY o el proveedor esté caído. Por eso el
test monta el router en una app limpia (sin el load_dotenv de main.py), borra
la clave del entorno y además sabotea get_chat_service: si el endpoint lo
llamara, el test se pondría rojo.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import importlib

from app.services.ai.chat_modes import CHAT_MODES, DEFAULT_MODE

# import_module y no `from app.routers import chat_router`: el __init__ del
# paquete re-exporta con ese mismo nombre el APIRouter, no el módulo.
chat_router_module = importlib.import_module("app.routers.chat_router")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def _explota():
        raise AssertionError(
            "/modes no debe depender del proveedor de IA: es un catálogo estático"
        )

    monkeypatch.setattr(chat_router_module, "get_chat_service", _explota)

    app = FastAPI()
    app.include_router(chat_router_module.router)
    return TestClient(app)


class TestChatModes:
    def test_responde_200_sin_api_key(self, client):
        response = client.get("/api/chat/modes")

        assert response.status_code == 200

    def test_el_modo_por_defecto_es_analisis(self, client):
        payload = client.get("/api/chat/modes").json()

        assert payload["default"] == "analisis"
        assert payload["default"] == DEFAULT_MODE

    def test_devuelve_todos_los_modos(self, client):
        payload = client.get("/api/chat/modes").json()

        assert len(payload["modes"]) == len(CHAT_MODES)
        assert {m["id"] for m in payload["modes"]} == set(CHAT_MODES)

    def test_ningun_modo_expone_su_prompt(self, client):
        payload = client.get("/api/chat/modes").json()

        for mode in payload["modes"]:
            assert "prompt" not in mode
            assert set(mode) == {"id", "label", "hint", "examples", "deep"}

    def test_cada_modo_trae_ejemplos_para_la_pantalla_vacia(self, client):
        payload = client.get("/api/chat/modes").json()

        for mode in payload["modes"]:
            assert mode["examples"]
            assert all(isinstance(e, str) and e.strip() for e in mode["examples"])
