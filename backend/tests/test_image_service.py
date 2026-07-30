"""
Tests de la generación de ilustraciones. Sin red.

El test que no se puede tocar es
``test_la_salvaguarda_va_siempre_pase_lo_que_pase``: el sufijo que prohíbe
texto en la imagen y representaciones de personas bíblicas tiene que llegar al
proveedor SIEMPRE, con cualquier prompt, incluido uno kilométrico que obligue a
recortar. Si alguien "optimiza" el recorte y se lleva por delante el sufijo,
este test se pone rojo antes de que llegue a producción.
"""

import base64

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import importlib

from app.services.ai import image_service
from app.services.ai.chat_providers import GOOGLE, OPENAI
from app.services.ai.image_service import (
    MAX_PROMPT_CHARS,
    SAFEGUARD_SUFFIX,
    build_prompt,
    build_request,
    generate_image,
    images_url,
    normalize_count,
    normalize_model,
    normalize_quality,
    normalize_size,
    parse_response,
)
from app.services.ai.redaction import contains_secret

images_router_module = importlib.import_module("app.routers.images_router")

FAKE_OPENAI_KEY = "sk-testtesttesttesttesttesttest"
FAKE_GOOGLE_KEY = "AIzaTESTTESTTESTTESTTESTTESTTEST"

_REAL_ASYNC_CLIENT = httpx.AsyncClient

PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
WEBP_B64 = base64.b64encode(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64).decode()


# ─── Salvaguarda de contenido ────────────────────────────────────


class TestSalvaguarda:
    @pytest.mark.parametrize(
        "prompt",
        [
            "Un árbol de raíces entrelazadas",
            "x",
            "   ",
            "Jesús predicando a la multitud",
            "a" * 5000,
        ],
    )
    def test_la_salvaguarda_va_siempre_pase_lo_que_pase(self, prompt):
        assert SAFEGUARD_SUFFIX in build_prompt(prompt)

    def test_el_texto_exacto_de_la_salvaguarda_no_se_toca(self):
        # Palabra por palabra: es un compromiso de producto, no un detalle.
        assert SAFEGUARD_SUFFIX == (
            "sin texto ni caracteres en la imagen, sin representaciones de "
            "personas bíblicas ni escenas religiosas identificables"
        )

    def test_un_prompt_kilometrico_recorta_lo_del_usuario_no_la_salvaguarda(self):
        final = build_prompt("a" * 9000)

        assert len(final) <= MAX_PROMPT_CHARS
        assert final.endswith(f"{SAFEGUARD_SUFFIX}.")

    def test_la_salvaguarda_llega_al_cuerpo_de_la_peticion(self):
        for spec in (OPENAI, GOOGLE):
            body = build_request(
                spec, build_prompt("un faro"), spec.image_models[0], "1024x1024", "medium", 1
            )
            assert SAFEGUARD_SUFFIX in body["prompt"]


# ─── Normalización ───────────────────────────────────────────────


class TestNormalizacion:
    @pytest.mark.parametrize(
        "value", [None, "", "gigante", "4096x4096", "1024 x 1024x"]
    )
    def test_un_tamano_fuera_de_rango_cae_al_default(self, value):
        assert normalize_size(value) == "1024x1024"

    def test_los_tamanos_validos_se_respetan(self):
        assert normalize_size("1536x1024") == "1536x1024"
        assert normalize_size(" 1024X1536 ") == "1024x1536"

    @pytest.mark.parametrize("value", [None, "", "ultra", "auto"])
    def test_una_calidad_desconocida_cae_al_default(self, value):
        assert normalize_quality(value) == "medium"

    @pytest.mark.parametrize(
        "value,esperado", [(0, 1), (1, 1), (2, 2), (9, 2), (-3, 1), ("x", 1), (None, 1)]
    )
    def test_el_numero_de_imagenes_se_acota(self, value, esperado):
        # Cada imagen cuesta dinero: el tope es una salvaguarda de factura.
        assert normalize_count(value) == esperado

    def test_el_modelo_que_se_deprecia_nunca_se_usa(self):
        # gpt-image-1 se retira el 23/10/2026.
        assert normalize_model(OPENAI, "gpt-image-1") == "gpt-image-1-mini"
        assert normalize_model(OPENAI, None) == "gpt-image-1-mini"
        assert normalize_model(OPENAI, "gpt-image-2") == "gpt-image-2"

    def test_un_modelo_de_otro_proveedor_no_se_cuela(self):
        assert normalize_model(GOOGLE, "gpt-image-2") == "gemini-2.5-flash-image"


class TestMapeoDeLaPeticion:
    def test_openai_pide_webp_para_no_reventar_la_base_local(self):
        # Un PNG de 1024² en base64 pesa ~2 MB, y sql.js serializa la base
        # entera en cada guardado.
        body = build_request(OPENAI, "p", "gpt-image-1-mini", "1024x1024", "high", 1)

        assert body["output_format"] == "webp"
        assert body["quality"] == "high"

    def test_google_solo_manda_lo_que_su_capa_de_compatibilidad_admite(self):
        body = build_request(GOOGLE, "p", "gemini-2.5-flash-image", "1024x1024", "high", 1)

        assert set(body) == {"model", "prompt", "n", "size", "response_format"}
        assert body["response_format"] == "b64_json"

    def test_cada_proveedor_tiene_su_endpoint(self):
        assert images_url(OPENAI) == "https://api.openai.com/v1/images/generations"
        assert images_url(GOOGLE) == (
            "https://generativelanguage.googleapis.com/v1beta/openai/images/generations"
        )


class TestParseResponse:
    def test_se_detecta_el_tipo_real_por_los_bytes(self):
        # Google no acepta output_format y devuelve lo que quiere; un mime
        # equivocado rompe el data: URI y la imagen no se ve.
        png = parse_response({"data": [{"b64_json": PNG_B64}]}, "1024x1024")
        webp = parse_response({"data": [{"b64_json": WEBP_B64}]}, "1024x1024")

        assert png[0].mime == "image/png"
        assert webp[0].mime == "image/webp"

    def test_las_dimensiones_salen_del_tamano_pedido(self):
        imagen = parse_response({"data": [{"b64_json": PNG_B64}]}, "1536x1024")[0]

        assert (imagen.width, imagen.height) == (1536, 1024)

    def test_una_respuesta_rota_no_lanza(self):
        assert parse_response({}, "1024x1024") == []
        assert parse_response({"data": [None, {}, {"b64_json": ""}]}, "1024x1024") == []


# ─── Errores saneados ────────────────────────────────────────────


@pytest.fixture()
def transporte(monkeypatch):
    def _install(handler):
        def factory(*args, **kwargs):
            kwargs.pop("timeout", None)
            kwargs.pop("transport", None)
            return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(image_service.httpx, "AsyncClient", factory)

    return _install


class TestErrores:
    @pytest.mark.asyncio
    async def test_una_key_invalida_da_401_sin_eco_de_la_key(self, transporte):
        transporte(
            lambda request: httpx.Response(
                401,
                json={"error": {"message": f"Incorrect API key: {FAKE_OPENAI_KEY}"}},
            )
        )

        with pytest.raises(HTTPException) as excinfo:
            await generate_image(OPENAI, FAKE_OPENAI_KEY, "un faro")

        assert excinfo.value.status_code == 401
        assert FAKE_OPENAI_KEY not in excinfo.value.detail
        assert not contains_secret(excinfo.value.detail)

    @pytest.mark.asyncio
    async def test_el_rechazo_por_politica_tiene_su_propio_mensaje(self, transporte):
        transporte(
            lambda request: httpx.Response(
                400,
                json={"error": {"code": "content_policy_violation", "message": "no"}},
            )
        )

        with pytest.raises(HTTPException) as excinfo:
            await generate_image(OPENAI, FAKE_OPENAI_KEY, "algo")

        assert excinfo.value.status_code == 400
        assert "fenómeno natural" in excinfo.value.detail

    @pytest.mark.asyncio
    async def test_el_limite_de_peticiones_se_explica(self, transporte):
        transporte(lambda request: httpx.Response(429, json={}))

        with pytest.raises(HTTPException) as excinfo:
            await generate_image(OPENAI, FAKE_OPENAI_KEY, "un faro")

        assert excinfo.value.status_code == 429

    @pytest.mark.asyncio
    async def test_un_timeout_no_se_traga_en_silencio(self, transporte):
        def handler(request):
            raise httpx.ConnectTimeout("tarde")

        transporte(handler)

        with pytest.raises(HTTPException) as excinfo:
            await generate_image(OPENAI, FAKE_OPENAI_KEY, "un faro")

        assert excinfo.value.status_code == 504

    @pytest.mark.asyncio
    async def test_sin_key_se_pide_configurarla(self, transporte):
        def handler(request):
            raise AssertionError("no debería haber red sin key")

        transporte(handler)

        with pytest.raises(HTTPException) as excinfo:
            await generate_image(OPENAI, "", "un faro")

        assert excinfo.value.status_code == 428


class TestLlamadaCompleta:
    @pytest.mark.asyncio
    async def test_la_key_va_en_la_cabecera_de_cada_proveedor(self, transporte):
        vistas = {}

        def handler(request: httpx.Request) -> httpx.Response:
            vistas.update(request.headers)
            assert FAKE_OPENAI_KEY not in str(request.url)
            assert FAKE_GOOGLE_KEY not in str(request.url)
            return httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]})

        transporte(handler)

        await generate_image(OPENAI, FAKE_OPENAI_KEY, "un faro")
        assert vistas["authorization"] == f"Bearer {FAKE_OPENAI_KEY}"

        await generate_image(GOOGLE, FAKE_GOOGLE_KEY, "un faro")
        assert vistas["x-goog-api-key"] == FAKE_GOOGLE_KEY

    @pytest.mark.asyncio
    async def test_devuelve_el_modelo_usado_y_las_imagenes(self, transporte):
        transporte(
            lambda request: httpx.Response(
                200, json={"data": [{"b64_json": WEBP_B64, "revised_prompt": "faro"}]}
            )
        )

        model, images = await generate_image(
            OPENAI, FAKE_OPENAI_KEY, "un faro", model="gpt-image-2"
        )

        assert model == "gpt-image-2"
        assert images[0].revised_prompt == "faro"


# ─── Router ──────────────────────────────────────────────────────


class TestRouter:
    @pytest.fixture()
    def client(self, monkeypatch):
        for var in ("OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
            monkeypatch.delenv(var, raising=False)
        app = FastAPI()
        app.include_router(images_router_module.router)
        return TestClient(app)

    def test_devuelve_el_prompt_final_con_la_salvaguarda(self, client, transporte):
        transporte(
            lambda request: httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]})
        )

        response = client.post(
            "/api/images/generate",
            json={"prompt": "un faro en la niebla"},
            headers={"X-AI-Api-Key": FAKE_OPENAI_KEY},
        )

        assert response.status_code == 200
        body = response.json()
        assert SAFEGUARD_SUFFIX in body["prompt"]
        assert body["images"][0]["mime"] == "image/png"

    def test_la_key_no_vuelve_en_la_respuesta(self, client, transporte):
        transporte(
            lambda request: httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]})
        )

        raw = client.post(
            "/api/images/generate",
            json={"prompt": "un faro"},
            headers={"X-AI-Api-Key": FAKE_OPENAI_KEY},
        ).text

        assert FAKE_OPENAI_KEY not in raw
        assert not contains_secret(raw)

    def test_sin_key_de_ningun_tipo_pide_configurarla(self, client):
        response = client.post("/api/images/generate", json={"prompt": "un faro"})

        assert response.status_code == 428
