"""
Tests de la investigación profunda. Sin red y sin keys.

Se prueba lo que decide comportamiento y no la llamada al modelo: el parseo del
plan (que es el punto de fallo de formato de una tarea de cinco minutos), los
presupuestos, y sobre todo el **búfer de eventos numerados**, que es lo que
permite reanudar tras un túnel o un cambio de red. Sin eso, un informe de tres
minutos se pierde entero por perder la cobertura diez segundos.
"""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.ai import research_service
from app.services.ai.research_service import (
    JobLimitReached,
    RESEARCH_JOB_TTL_SECONDS,
    ResearchJob,
    ResearchRegistry,
    estimated_seconds,
    fallback_plan,
    get_registry,
    parse_plan,
    stream_job,
)

research_router_module = importlib.import_module("app.routers.research_router")


@pytest.fixture(autouse=True)
def _registro_limpio():
    get_registry().clear()
    yield
    get_registry().clear()


# ─── Plan ────────────────────────────────────────────────────────


class TestParsePlan:
    def test_un_array_json_valido_se_respeta(self):
        crudo = '["¿Qué dice la Atalaya?", "¿Qué versículos?", "¿Cómo se aplica?", "¿Qué ejemplos?"]'

        plan = parse_plan(crudo, "el aguante")

        assert len(plan) == 4
        assert plan[0].startswith("¿Qué dice")

    def test_una_valla_de_markdown_no_estorba(self):
        crudo = '```json\n["uno", "dos", "tres", "cuatro"]\n```'

        assert parse_plan(crudo, "x") == ["uno", "dos", "tres", "cuatro"]

    @pytest.mark.parametrize(
        "crudo",
        ["", "   ", "no soy json", "{}", "[]", '["solo una"]', '[1, 2, 3, 4]', "null"],
    )
    def test_cualquier_basura_cae_al_plan_de_respaldo(self, crudo):
        # El formato del plan no puede ser el punto de fallo de una tarea de
        # cinco minutos: mejor un plan mediocre que ninguna investigación.
        plan = parse_plan(crudo, "el aguante")

        assert plan == fallback_plan("el aguante")
        assert len(plan) >= 3

    def test_un_plan_gigante_se_acota(self):
        crudo = "[" + ", ".join(f'"pregunta {i}"' for i in range(40)) + "]"

        assert len(parse_plan(crudo, "x")) == 7

    def test_el_respaldo_menciona_el_tema(self):
        plan = fallback_plan("el aguante en las pruebas")

        assert all("el aguante en las pruebas" in item for item in plan)

    def test_el_respaldo_aguanta_una_pregunta_vacia(self):
        assert fallback_plan("") and fallback_plan(None)  # type: ignore[arg-type]


class TestPresupuestos:
    """
    Se prueba ``_env_int`` directamente y NO recargando el módulo.

    Recargarlo cambia la identidad de las clases (``JobLimitReached``,
    ``ResearchRegistry``) y contamina el resto de la sesión de tests: un
    ``pytest.raises`` deja de capturar porque la excepción es "otra" clase con
    el mismo nombre. Se aprendió por las malas.
    """

    def test_los_defaults_son_los_del_plan(self):
        assert research_service.RESEARCH_MAX_TOOL_ROUNDS == 14
        assert research_service.RESEARCH_BUDGET_SECONDS == 300
        assert research_service.RESEARCH_MAX_DOCS == 12
        assert research_service.RESEARCH_JOB_TTL_SECONDS == 3600

    @pytest.mark.parametrize("basura", ["muchas", "", "   ", "3.5", "-"])
    def test_la_basura_degrada_al_default(self, monkeypatch, basura):
        monkeypatch.setenv("RESEARCH_MAX_TOOL_ROUNDS", basura)

        assert research_service._env_int("RESEARCH_MAX_TOOL_ROUNDS", 14, 4, 30) == 14

    def test_los_valores_fuera_de_rango_se_acotan(self, monkeypatch):
        # 400 rondas serían horas de latencia y una factura absurda.
        monkeypatch.setenv("RESEARCH_MAX_TOOL_ROUNDS", "400")
        monkeypatch.setenv("RESEARCH_BUDGET_SECONDS", "5")

        assert research_service._env_int("RESEARCH_MAX_TOOL_ROUNDS", 14, 4, 30) == 30
        assert research_service._env_int("RESEARCH_BUDGET_SECONDS", 300, 60, 1800) == 60

    def test_un_valor_valido_se_respeta(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_MAX_DOCS", "20")

        assert research_service._env_int("RESEARCH_MAX_DOCS", 12, 3, 30) == 20

    def test_la_estimacion_es_honesta_y_acotada(self):
        assert 60 <= estimated_seconds(1) <= research_service.RESEARCH_BUDGET_SECONDS
        assert 60 <= estimated_seconds(50) <= research_service.RESEARCH_BUDGET_SECONDS


# ─── Búfer de eventos ────────────────────────────────────────────


class TestBufferDeEventos:
    def test_los_eventos_se_numeran_desde_uno(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")

        primero = job.append("plan", {"items": []})
        segundo = job.append("progress", {"step": 1})

        assert (primero.id, segundo.id) == (1, 2)

    def test_reanudar_desde_el_tres_reemite_del_cuatro(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")
        for i in range(6):
            job.append("token", {"text": str(i)})

        reemitidos = job.since(3)

        assert [entry.id for entry in reemitidos] == [4, 5, 6]

    def test_reanudar_desde_cero_lo_reemite_todo(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")
        job.append("plan", {})
        job.append("done", {})

        assert len(job.since(0)) == 2

    def test_el_sse_lleva_el_id_para_que_el_navegador_lo_reenvie(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")

        sse = job.append("progress", {"step": 2}).to_sse()

        assert sse.startswith("id: 1\nevent: progress\ndata: ")
        assert sse.endswith("\n\n")

    def test_el_done_marca_el_trabajo_como_terminado(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")

        assert job.finished is False
        job.append("done", {"cancelled": False})
        assert job.finished is True

    @pytest.mark.asyncio
    async def test_el_stream_reanudado_no_repite_lo_ya_visto(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")
        for i in range(3):
            job.append("token", {"text": str(i)})
        job.append("done", {})

        trozos = [chunk async for chunk in stream_job(job, last_event_id=2)]

        assert len(trozos) == 2
        assert "id: 3" in trozos[0]
        assert "id: 4" in trozos[1]

    @pytest.mark.asyncio
    async def test_el_stream_de_un_trabajo_terminado_acaba_solo(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")
        job.append("done", {})

        trozos = [chunk async for chunk in stream_job(job, last_event_id=0)]

        assert len(trozos) == 1

    @pytest.mark.asyncio
    async def test_un_evento_que_llega_tarde_despierta_la_espera(self):
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")

        async def alimentar():
            await asyncio.sleep(0.05)
            job.append("token", {"text": "hola"})
            await asyncio.sleep(0.05)
            job.append("done", {})

        tarea = asyncio.create_task(alimentar())
        trozos = [chunk async for chunk in stream_job(job, keepalive=2.0)]
        await tarea

        assert any("hola" in chunk for chunk in trozos)
        assert any("event: done" in chunk for chunk in trozos)

    @pytest.mark.asyncio
    async def test_sin_novedades_se_manda_un_keepalive(self):
        # Los proxies cortan un SSE que lleva rato sin un byte, y una fase de
        # scraping puede pasar de un minuto sin emitir nada.
        job = ResearchJob(job_id="rs-1", question="q", mode_id="investigacion")

        agen = stream_job(job, keepalive=0.01)
        primero = await agen.__anext__()
        await agen.aclose()

        assert primero == ": ping\n\n"


# ─── Registro ────────────────────────────────────────────────────


class TestRegistro:
    def test_no_se_admiten_mas_trabajos_vivos_de_la_cuenta(self):
        registro = ResearchRegistry()
        for _ in range(research_service.RESEARCH_MAX_LIVE_JOBS):
            registro.create("q", "investigacion")

        with pytest.raises(JobLimitReached):
            registro.create("q", "investigacion")

    def test_un_trabajo_terminado_deja_sitio(self):
        registro = ResearchRegistry()
        jobs = [
            registro.create("q", "investigacion")
            for _ in range(research_service.RESEARCH_MAX_LIVE_JOBS)
        ]
        jobs[0].append("done", {})

        assert registro.create("q", "investigacion") is not None

    def test_la_purga_se_lleva_los_caducados_y_respeta_los_vivos(self):
        registro = ResearchRegistry()
        vivo = registro.create("q", "investigacion")
        viejo = registro.create("q", "investigacion")
        viejo.append("done", {})

        borrados = registro.purge(now=viejo.finished_at + RESEARCH_JOB_TTL_SECONDS + 1)

        assert borrados == 1
        assert registro.get(viejo.job_id) is None
        assert registro.get(vivo.job_id) is not None

    def test_cancelar_emite_un_done_con_la_marca(self):
        registro = ResearchRegistry()
        job = registro.create("q", "investigacion")

        assert registro.cancel(job.job_id) is True
        assert job.cancelled is True
        assert job.events[-1].event == "done"
        assert job.events[-1].data["cancelled"] is True

    def test_cancelar_uno_ya_terminado_no_hace_nada(self):
        registro = ResearchRegistry()
        job = registro.create("q", "investigacion")
        job.append("done", {})

        assert registro.cancel(job.job_id) is False

    def test_los_ids_no_se_repiten(self):
        registro = ResearchRegistry()
        ids = {registro.create("q", "investigacion").job_id for _ in range(4)}

        assert len(ids) == 4


# ─── Router ──────────────────────────────────────────────────────


class TestRouter:
    @pytest.fixture()
    def client(self):
        app = FastAPI()
        app.include_router(research_router_module.router)
        return TestClient(app)

    def test_un_trabajo_que_ya_no_existe_da_404_reanudable(self, client):
        # Un redeploy de Railway mata los trabajos: el 404 es la señal de que
        # el cliente debe ofrecer "Reanudar" con lo que tiene guardado.
        response = client.get("/api/research/rs-no-existe")

        assert response.status_code == 404
        assert "reanudarla" in response.json()["detail"]

    def test_la_instantanea_trae_el_plan_y_el_ultimo_evento(self, client):
        job = get_registry().create("el aguante", "investigacion")
        job.plan = ["uno", "dos"]
        job.append("plan", {"items": []})

        payload = client.get(f"/api/research/{job.job_id}").json()

        assert payload["plan"] == ["uno", "dos"]
        assert payload["last_event_id"] == 1
        assert payload["finished"] is False

    def test_cancelar_devuelve_204(self, client):
        job = get_registry().create("q", "investigacion")

        assert client.post(f"/api/research/{job.job_id}/cancel").status_code == 204
        assert job.cancelled is True

    def test_cancelar_lo_que_no_existe_da_404(self, client):
        assert client.post("/api/research/rs-no/cancel").status_code == 404

    def test_el_stream_reemite_desde_el_last_event_id(self, client):
        job = get_registry().create("q", "investigacion")
        job.append("plan", {"items": []})
        job.append("progress", {"step": 1})
        job.append("done", {})

        with client.stream(
            "GET", f"/api/research/stream/{job.job_id}", headers={"Last-Event-ID": "2"}
        ) as response:
            cuerpo = "".join(response.iter_text())

        assert "event: plan" not in cuerpo
        assert "id: 3" in cuerpo

    def test_el_stream_de_un_trabajo_inexistente_da_404(self, client):
        assert client.get("/api/research/stream/rs-no").status_code == 404
