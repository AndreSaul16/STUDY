"""
Tests del catálogo de modelos.

Sin red: se trabaja sobre payloads congelados en ``tests/fixtures/`` que imitan
lo que devuelven de verdad ``GET /v1/models`` (OpenAI) y
``GET /v1beta/models`` (Google), y el transporte se sustituye por un
``httpx.MockTransport``.

La regresión que de verdad importa está en
``test_un_modelo_futuro_desconocido_aparece_igualmente``: el filtro de OpenAI es
heurístico por narices (su endpoint no da metadatos de capacidad) y tiene que
estar diseñado para no caducar. Si algún día alguien convierte la lista blanca
de prefijos en un filtro, ese test se pone rojo.
"""

import json
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

from app.services.ai import model_catalog
from app.services.ai.chat_providers import GOOGLE, OPENAI
from app.services.ai.model_catalog import (
    clear_cache,
    fallback_result,
    list_models,
    normalize_purpose,
    parse_google_models,
    parse_openai_models,
)

FIXTURES = Path(__file__).parent / "fixtures"
FAKE_OPENAI_KEY = "sk-testtesttesttesttesttesttest"
FAKE_GOOGLE_KEY = "AIzaTESTTESTTESTTESTTESTTESTTEST"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _sin_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture()
def openai_payload():
    return _fixture("openai_models.json")


@pytest.fixture()
def google_payload():
    return _fixture("google_models.json")


def _ids(models):
    return [m["id"] for m in models]


# ─── OpenAI ──────────────────────────────────────────────────────


class TestParseOpenAI:
    def test_no_se_cuela_nada_de_la_lista_negra(self, openai_payload):
        ids = _ids(parse_openai_models(openai_payload, OPENAI, "chat"))

        for prohibido in (
            "tts-1",
            "tts-1-hd",
            "whisper-1",
            "gpt-4o-transcribe",
            "text-embedding-3-small",
            "text-embedding-ada-002",
            "omni-moderation-latest",
            "dall-e-3",
            "gpt-image-1",
            "gpt-image-1-mini",
            "sora-2",
            "o3-deep-research",
            "codex-mini-latest",
            "computer-use-preview",
            "gpt-3.5-turbo-instruct",
            "gpt-4o-search-preview",
            "gpt-4o-audio-preview",
            "gpt-realtime",
            "llama-guard-4-12b",
        ):
            assert prohibido not in ids, prohibido

    def test_un_modelo_futuro_desconocido_aparece_igualmente(self, openai_payload):
        # LA regresión de este módulo: la lista blanca solo ORDENA. Si algún día
        # se convierte en un filtro, el usuario deja de ver los modelos nuevos y
        # nadie se entera hasta que se queja.
        ids = _ids(parse_openai_models(openai_payload, OPENAI, "chat"))

        assert "gpt-7-preview" in ids

    def test_los_preferidos_van_delante_de_los_veteranos(self, openai_payload):
        ids = _ids(parse_openai_models(openai_payload, OPENAI, "chat"))

        assert ids.index("gpt-5.6-luna") < ids.index("gpt-4o-mini")

    def test_la_familia_actual_se_marca_como_recomendada(self, openai_payload):
        models = {m["id"]: m for m in parse_openai_models(openai_payload, OPENAI, "chat")}

        assert models["gpt-5.6-luna"]["recommended"] is True
        assert models["gpt-4o-mini"]["recommended"] is False

    def test_los_modelos_de_razonamiento_se_marcan(self, openai_payload):
        models = {m["id"]: m for m in parse_openai_models(openai_payload, OPENAI, "chat")}

        assert models["gpt-5.6-luna"]["reasoning"] is True
        assert models["gpt-4o-mini"]["reasoning"] is False

    def test_el_proposito_imagen_no_ofrece_el_modelo_que_se_deprecia(
        self, openai_payload
    ):
        # gpt-image-1 se retira el 23/10/2026: ofrecerlo sería vender una avería.
        ids = _ids(parse_openai_models(openai_payload, OPENAI, "image"))

        assert "gpt-image-1" not in ids
        assert "gpt-image-1-mini" in ids
        assert "gpt-image-2" in ids

    def test_el_proposito_research_solo_da_los_de_deep_research(self, openai_payload):
        ids = _ids(parse_openai_models(openai_payload, OPENAI, "research"))

        assert ids == ["o4-mini-deep-research", "o3-deep-research"]

    def test_un_payload_roto_no_lanza(self):
        assert parse_openai_models({}, OPENAI, "chat") == []
        assert parse_openai_models({"data": "no es una lista"}, OPENAI, "chat") == []
        assert parse_openai_models({"data": [None, 3, {}]}, OPENAI, "chat") == []


# ─── Google ──────────────────────────────────────────────────────


class TestParseGoogle:
    def test_solo_entran_los_que_generan_contenido(self, google_payload):
        ids = _ids(parse_google_models([google_payload], GOOGLE, "chat"))

        assert "gemini-3.5-flash" in ids
        for fuera in (
            "gemini-embedding-001",
            "text-embedding-004",
            "veo-3.1-generate-preview",
            "imagen-4.0-generate-001",
            "gemini-2.5-flash-tts",
            "gemini-live-2.5-flash-preview",
            "aqa",
            "gemini-robotics-er-1.5-preview",
        ):
            assert fuera not in ids, fuera

    def test_se_recorta_el_prefijo_models(self, google_payload):
        ids = _ids(parse_google_models([google_payload], GOOGLE, "chat"))

        assert all(not model_id.startswith("models/") for model_id in ids)

    def test_los_de_imagen_no_ensucian_el_selector_de_chat(self, google_payload):
        chat = _ids(parse_google_models([google_payload], GOOGLE, "chat"))
        image = _ids(parse_google_models([google_payload], GOOGLE, "image"))

        assert "gemini-2.5-flash-image" not in chat
        assert set(image) == {"gemini-2.5-flash-image", "gemini-3-pro-image-preview"}

    def test_se_aprovechan_los_metadatos_que_google_si_da(self, google_payload):
        models = {m["id"]: m for m in parse_google_models([google_payload], GOOGLE, "chat")}

        assert models["gemini-2.5-pro"]["label"] == "Gemini 2.5 Pro"
        assert models["gemini-2.5-pro"]["description"].startswith("Generación anterior")
        assert models["gemini-2.5-pro"]["context"] == 2097152

    def test_la_generacion_actual_se_marca_como_recomendada(self, google_payload):
        models = {m["id"]: m for m in parse_google_models([google_payload], GOOGLE, "chat")}

        assert models["gemini-3.6-flash"]["recommended"] is True
        assert models["gemini-2.5-flash"]["recommended"] is False

    def test_los_recomendados_salen_primero(self, google_payload):
        ids = _ids(parse_google_models([google_payload], GOOGLE, "chat"))

        assert ids.index("gemini-3.6-flash") < ids.index("gemini-2.5-flash")

    def test_paginas_repetidas_no_duplican(self, google_payload):
        ids = _ids(parse_google_models([google_payload, google_payload], GOOGLE, "chat"))

        assert len(ids) == len(set(ids))


# ─── list_models: transporte, errores y caché ────────────────────


#: Se guarda la clase real ANTES de parchear: monkeypatchear
#: ``model_catalog.httpx.AsyncClient`` toca el módulo httpx compartido, y una
#: factoría que llamara a ``httpx.AsyncClient`` se llamaría a sí misma.
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _client_factory(handler):
    """Sustituye el transporte de httpx sin tocar la firma de list_models."""

    def factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        kwargs.pop("transport", None)
        return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kwargs)

    return factory


@pytest.fixture()
def transporte(monkeypatch):
    def _install(handler):
        monkeypatch.setattr(model_catalog.httpx, "AsyncClient", _client_factory(handler))

    return _install


class TestListModels:
    @pytest.mark.asyncio
    async def test_openai_devuelve_la_lista_real(self, transporte, openai_payload):
        transporte(lambda request: httpx.Response(200, json=openai_payload))

        result = await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert result.source == "api"
        assert "gpt-5.6-luna" in _ids(result.models)

    @pytest.mark.asyncio
    async def test_la_key_viaja_en_la_cabecera_de_cada_proveedor(
        self, transporte, openai_payload, google_payload
    ):
        vistas = {}

        def handler(request: httpx.Request) -> httpx.Response:
            vistas.update(request.headers)
            # La key JAMÁS puede acabar en la URL: quedaría en los logs del
            # proxy y en el historial del navegador.
            assert FAKE_OPENAI_KEY not in str(request.url)
            assert FAKE_GOOGLE_KEY not in str(request.url)
            payload = google_payload if "googleapis" in str(request.url) else openai_payload
            return httpx.Response(200, json=payload)

        transporte(handler)

        await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")
        assert vistas["authorization"] == f"Bearer {FAKE_OPENAI_KEY}"

        await list_models(GOOGLE, FAKE_GOOGLE_KEY, "chat")
        assert vistas["x-goog-api-key"] == FAKE_GOOGLE_KEY

    @pytest.mark.asyncio
    async def test_google_pagina_hasta_agotar(self, transporte, google_payload):
        llamadas = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            llamadas["n"] += 1
            if llamadas["n"] == 1:
                return httpx.Response(
                    200, json={**google_payload, "nextPageToken": "siguiente"}
                )
            return httpx.Response(200, json=google_payload)

        transporte(handler)

        result = await list_models(GOOGLE, FAKE_GOOGLE_KEY, "chat")

        assert llamadas["n"] == 2
        assert result.source == "api"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_una_key_invalida_da_401_saneado(self, transporte, status):
        # El cuerpo del proveedor hace eco de la key. NO se reenvía.
        transporte(
            lambda request: httpx.Response(
                status,
                json={
                    "error": {
                        "message": f"Incorrect API key provided: {FAKE_OPENAI_KEY}"
                    }
                },
            )
        )

        with pytest.raises(HTTPException) as excinfo:
            await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert excinfo.value.status_code == 401
        assert "OpenAI" in excinfo.value.detail
        assert FAKE_OPENAI_KEY not in excinfo.value.detail
        assert "sk-" not in excinfo.value.detail

    @pytest.mark.asyncio
    async def test_el_limite_de_peticiones_se_explica(self, transporte):
        transporte(lambda request: httpx.Response(429, json={}))

        with pytest.raises(HTTPException) as excinfo:
            await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert excinfo.value.status_code == 429

    @pytest.mark.asyncio
    async def test_un_timeout_degrada_a_la_lista_de_respaldo(self, transporte):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("se acabó el tiempo")

        transporte(handler)

        result = await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert result.source == "fallback"
        assert result.models  # NUNCA vacío: sin lista no hay app
        assert result.notice

    @pytest.mark.asyncio
    async def test_un_500_del_proveedor_tambien_degrada(self, transporte):
        transporte(lambda request: httpx.Response(500, text="boom"))

        result = await list_models(GOOGLE, FAKE_GOOGLE_KEY, "chat")

        assert result.source == "fallback"
        assert result.models

    @pytest.mark.asyncio
    async def test_sin_key_no_se_llama_al_proveedor(self, transporte):
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("no debería haber red sin key")

        transporte(handler)

        result = await list_models(OPENAI, "", "chat")

        assert result.source == "fallback"
        assert result.models

    @pytest.mark.asyncio
    async def test_la_segunda_llamada_sale_de_la_cache(self, transporte, openai_payload):
        llamadas = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            llamadas["n"] += 1
            return httpx.Response(200, json=openai_payload)

        transporte(handler)

        await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")
        await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert llamadas["n"] == 1

    @pytest.mark.asyncio
    async def test_la_cache_no_guarda_la_key(self, transporte, openai_payload):
        transporte(lambda request: httpx.Response(200, json=openai_payload))

        await list_models(OPENAI, FAKE_OPENAI_KEY, "chat")

        assert FAKE_OPENAI_KEY not in repr(list(model_catalog._cache.keys()))

    @pytest.mark.asyncio
    async def test_la_cache_no_crece_sin_limite(self, transporte, openai_payload):
        transporte(lambda request: httpx.Response(200, json=openai_payload))

        for i in range(model_catalog.CACHE_MAX_ENTRIES + 10):
            await list_models(OPENAI, f"sk-testkey{i:020d}", "chat")

        assert len(model_catalog._cache) <= model_catalog.CACHE_MAX_ENTRIES


class TestNormalizePurpose:
    @pytest.mark.parametrize("value", [None, "", "loquesea", "CHAT "])
    def test_lo_que_no_se_reconoce_es_chat(self, value):
        assert normalize_purpose(value) == "chat"

    @pytest.mark.parametrize("value", ["image", "research", "chat"])
    def test_los_validos_se_respetan(self, value):
        assert normalize_purpose(value) == value


class TestFallbackResult:
    def test_ningun_respaldo_esta_vacio(self):
        for spec in (OPENAI, GOOGLE):
            for purpose in ("chat", "image"):
                assert fallback_result(spec, purpose, "x").models, (spec.id, purpose)
