"""
Tests de la descarga sin conexión. Sin red y sin esperas reales.

Lo que se prueba es lo que decide comportamiento, no la petición a WOL: que
**no se vuelve a pedir lo que ya está en la caché** (sin eso, relanzar tras un
corte volvería a descargar horas de contenido), que **un capítulo roto no tira
la descarga entera**, el cálculo del progreso y la cancelación.

El motor recibe por parámetro la descarga, el reloj, la pausa y la consulta a
la caché, así que estos tests corren en milisegundos y no dependen de la hora
del sistema ni de que WOL esté en pie.
"""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.jw import offline_library
from app.services.jw.offline_library import (
    DownloadJob,
    DownloadRegistry,
    JobLimitReached,
    OFFLINE_JOB_TTL_SECONDS,
    cache_key,
    chapter_targets,
    estimated_seconds,
    get_registry,
    library_status,
    run_download,
    stream_job,
    total_chapters,
)

offline_router_module = importlib.import_module("app.routers.offline_router")


@pytest.fixture(autouse=True)
def _registro_limpio():
    get_registry().clear()
    yield
    get_registry().clear()


def _job(targets, created_at=1000.0) -> DownloadJob:
    """Un trabajo suelto, sin registro y con el reloj fijado."""
    return DownloadJob(job_id="off-test", targets=list(targets), created_at=created_at)


class _Reloj:
    """Reloj falso: avanza solo cuando se le llama, sin tocar la hora real."""

    def __init__(self, inicio: float = 1000.0, paso: float = 1.0) -> None:
        self.ahora = inicio
        self.paso = paso

    def __call__(self) -> float:
        self.ahora += self.paso
        return self.ahora


async def _sin_esperar(_seconds: float) -> None:
    """Sustituye a ``asyncio.sleep``: la pausa de cortesía no se prueba en vivo."""
    return None


# ─── Alcance ─────────────────────────────────────────────────────


class TestAlcance:
    def test_la_biblia_entera_son_1189_capitulos(self):
        assert total_chapters() == 1189
        assert len(chapter_targets()) == 1189

    def test_el_orden_es_el_canonico(self):
        objetivos = chapter_targets()

        assert objetivos[0] == (1, 1)
        assert objetivos[-1] == (66, 22)

    def test_se_puede_acotar_a_unos_libros(self):
        # Reintentar solo lo que falló no debe costar recorrer los 1.189.
        objetivos = chapter_targets([65, 63])

        assert objetivos == [(63, 1), (65, 1)]

    @pytest.mark.parametrize("basura", [[0], [67], [-3], [999]])
    def test_los_numeros_imposibles_se_descartan(self, basura):
        assert chapter_targets(basura) == []

    def test_la_clave_tiene_la_forma_que_escribe_el_lector(self):
        assert cache_key(43, 3) == "43:3"


# ─── Saltarse lo ya descargado ───────────────────────────────────


class TestSeSaltaLoCacheado:
    @pytest.mark.asyncio
    async def test_lo_que_ya_esta_en_la_cache_no_se_pide(self):
        pedidos = []

        async def descargar(book, chapter):
            pedidos.append((book, chapter))

        job = _job([(65, 1), (63, 1), (64, 1)])
        # Judas ya estaba descargado de una lectura anterior.
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda book, chapter: book == 65,
            delay=0,
        )

        assert pedidos == [(63, 1), (64, 1)]
        assert job.skipped == 1
        assert job.downloaded == 2

    @pytest.mark.asyncio
    async def test_con_todo_cacheado_no_se_toca_la_red(self):
        async def descargar(book, chapter):
            raise AssertionError("no debería pedirse nada")

        job = _job(chapter_targets([63, 64, 65]))
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: True,
            delay=0,
        )

        assert job.skipped == 3
        assert job.downloaded == 0
        assert job.processed == job.total

    @pytest.mark.asyncio
    async def test_el_plan_anuncia_cuanto_queda_de_verdad(self):
        job = _job(chapter_targets([63, 64, 65]))
        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda book, _chapter: book == 63,
            delay=0,
        )

        plan = next(e for e in job.events if e.event == "plan")
        assert plan.data["total"] == 3
        assert plan.data["skipped"] == 1
        assert plan.data["pending"] == 2


# ─── Tolerancia a fallos ─────────────────────────────────────────


class TestTolerancia:
    @pytest.mark.asyncio
    async def test_un_capitulo_roto_no_aborta_la_descarga(self):
        hechos = []

        async def descargar(book, chapter):
            if chapter == 2:
                raise RuntimeError("WOL devolvió un 503")
            hechos.append((book, chapter))

        job = _job([(1, 1), (1, 2), (1, 3), (1, 4)])
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=1,
            delay=0,
        )

        assert hechos == [(1, 1), (1, 3), (1, 4)]
        assert job.downloaded == 3
        assert [f["chapter"] for f in job.failures] == [2]
        assert job.events[-1].event == "done"

    @pytest.mark.asyncio
    async def test_el_fallo_se_anota_con_su_libro_y_capitulo(self):
        async def descargar(*_):
            raise TimeoutError("se agotó el tiempo")

        job = _job([(19, 117)])
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            delay=0,
        )

        assert job.failures == [{"book": 19, "chapter": 117, "label": "Salmos 117"}]

    @pytest.mark.asyncio
    async def test_aunque_falle_todo_se_termina_con_done(self):
        async def descargar(*_):
            raise RuntimeError("sin red")

        job = _job(chapter_targets([63, 64, 65]))
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            delay=0,
        )

        # Un trabajo que muere en silencio deja al cliente esperando siempre.
        assert job.finished is True
        assert len(job.failures) == 3
        assert job.events[-1].data["cancelled"] is False

    @pytest.mark.asyncio
    async def test_un_fallo_al_consultar_la_cache_no_tumba_el_trabajo(self):
        def cache_rota(*_):
            raise RuntimeError("la caché está corrupta")

        job = _job([(65, 1)])
        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=cache_rota,
            delay=0,
        )

        assert job.finished is True
        assert any(e.event == "error" for e in job.events)


# ─── Progreso ────────────────────────────────────────────────────


class TestProgreso:
    def test_lo_procesado_suma_saltados_hechos_y_fallidos(self):
        job = _job(chapter_targets([63, 64, 65]))
        job.skipped, job.downloaded = 1, 1
        job.failures.append({"book": 65, "chapter": 1, "label": "Judas 1"})

        progreso = job.progress(now=1000.0)
        assert progreso["done"] == 3
        assert progreso["total"] == 3
        assert (progreso["downloaded"], progreso["skipped"], progreso["failed"]) == (1, 1, 1)

    def test_el_tiempo_transcurrido_sale_del_reloj_inyectado(self):
        job = _job([(65, 1)], created_at=1000.0)

        assert job.progress(now=1012.5)["elapsed_ms"] == 12500

    def test_un_trabajo_terminado_congela_su_tiempo(self):
        job = _job([(65, 1)], created_at=1000.0)
        job.append("done", {"cancelled": False, "at": 1005.0})

        # Ya acabó: el contador no debe seguir corriendo al mirarlo más tarde.
        assert job.progress(now=99999.0)["elapsed_ms"] == 5000

    @pytest.mark.asyncio
    async def test_cada_capitulo_emite_un_progreso(self):
        job = _job([(1, 1), (1, 2), (1, 3)])
        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=1,
            delay=0,
        )

        progresos = [e for e in job.events if e.event == "progress"]
        assert [p.data["done"] for p in progresos] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_el_progreso_dice_en_que_va(self):
        job = _job([(19, 23)])
        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            delay=0,
        )

        assert job.progress(now=1000.0)["label"] == "Salmos 23"

    def test_la_estimacion_es_honesta_y_no_negativa(self):
        assert estimated_seconds(0) == 0
        assert estimated_seconds(10) < estimated_seconds(100)
        # La Biblia entera es una hora larga, medida. Prometer quince minutos y
        # tardar una hora es peor que no dar estimación: la cota inferior está
        # aquí para que nadie la "optimice" a la baja sin volver a cronometrar.
        assert 45 * 60 <= estimated_seconds(1189) <= 120 * 60


# ─── Concurrencia ────────────────────────────────────────────────


class TestConcurrencia:
    @pytest.mark.asyncio
    async def test_nunca_hay_mas_peticiones_a_la_vez_de_las_permitidas(self):
        # Esto raspa un sitio de terceros: la cortesía es parte del contrato.
        a_la_vez = 0
        pico = 0

        async def descargar(*_):
            nonlocal a_la_vez, pico
            a_la_vez += 1
            pico = max(pico, a_la_vez)
            await asyncio.sleep(0)
            a_la_vez -= 1

        job = _job(chapter_targets([19]))  # 150 capítulos
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=3,
            delay=0,
        )

        assert pico <= 3
        assert job.downloaded == 150

    @pytest.mark.asyncio
    async def test_no_se_arrancan_mas_workers_que_capitulos(self):
        arranques = 0

        async def descargar(*_):
            nonlocal arranques
            arranques += 1

        job = _job([(65, 1)])
        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=4,
            delay=0,
        )

        assert arranques == 1

    @pytest.mark.asyncio
    async def test_se_espera_entre_peticiones(self):
        pausas = []

        async def espiar_pausa(seconds):
            pausas.append(seconds)

        job = _job([(1, 1), (1, 2)])
        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=espiar_pausa,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=1,
            delay=0.25,
        )

        assert pausas == [0.25, 0.25]

    @pytest.mark.asyncio
    async def test_la_concurrencia_por_defecto_no_pasa_de_cuatro(self):
        assert 1 <= offline_library.OFFLINE_CONCURRENCY <= 4


# ─── Cancelación ─────────────────────────────────────────────────


class TestCancelacion:
    @pytest.mark.asyncio
    async def test_cancelar_a_media_descarga_la_para(self):
        registro = DownloadRegistry()
        job = registro.create(chapter_targets([19]), now=1000.0)  # 150 capítulos
        pedidos = []

        async def descargar(book, chapter):
            pedidos.append((book, chapter))
            if len(pedidos) == 5:
                registro.cancel(job.job_id, now=1010.0)

        await run_download(
            job,
            fetch=descargar,
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            concurrency=1,
            delay=0,
        )

        assert len(pedidos) == 5
        assert job.cancelled is True

    def test_cancelar_emite_un_done_con_la_marca(self):
        registro = DownloadRegistry()
        job = registro.create([(65, 1)], now=1000.0)

        assert registro.cancel(job.job_id, now=1003.0) is True
        assert job.events[-1].event == "done"
        assert job.events[-1].data["cancelled"] is True
        assert job.events[-1].data["elapsed_ms"] == 3000

    def test_cancelar_una_ya_terminada_no_hace_nada(self):
        registro = DownloadRegistry()
        job = registro.create([(65, 1)], now=1000.0)
        job.append("done", {"cancelled": False, "at": 1001.0})

        assert registro.cancel(job.job_id) is False

    @pytest.mark.asyncio
    async def test_una_cancelacion_no_emite_un_segundo_done(self):
        # Dos `done` dejarían al cliente pensando que la descarga acabó bien.
        registro = DownloadRegistry()
        job = registro.create([(1, 1), (1, 2)], now=1000.0)
        registro.cancel(job.job_id, now=1001.0)

        await run_download(
            job,
            fetch=lambda *_: asyncio.sleep(0),
            sleep=_sin_esperar,
            clock=_Reloj(),
            cached=lambda *_: False,
            delay=0,
        )

        assert [e.event for e in job.events].count("done") == 1


# ─── Registro ────────────────────────────────────────────────────


class TestRegistro:
    def test_solo_se_admite_una_descarga_viva(self):
        # Dos a la vez duplicarían el tráfico contra WOL sin acelerar nada.
        registro = DownloadRegistry()
        registro.create([(65, 1)], now=1000.0)

        with pytest.raises(JobLimitReached):
            registro.create([(63, 1)], now=1000.0)

    def test_una_terminada_deja_sitio(self):
        registro = DownloadRegistry()
        primera = registro.create([(65, 1)], now=1000.0)
        primera.append("done", {"cancelled": False, "at": 1001.0})

        assert registro.create([(63, 1)], now=1002.0) is not None

    def test_la_purga_se_lleva_las_caducadas_y_respeta_las_vivas(self):
        registro = DownloadRegistry()
        vieja = registro.create([(65, 1)], now=1000.0)
        vieja.append("done", {"cancelled": False, "at": 1001.0})

        borradas = registro.purge(now=1001.0 + OFFLINE_JOB_TTL_SECONDS + 1)

        assert borradas == 1
        assert registro.get(vieja.job_id) is None

    def test_la_viva_se_puede_recuperar_para_reengancharse(self):
        registro = DownloadRegistry()
        job = registro.create([(65, 1)], now=1000.0)

        assert registro.live_job() is job

    def test_sin_nada_en_marcha_no_hay_viva(self):
        assert DownloadRegistry().live_job() is None


# ─── Estado de la caché ──────────────────────────────────────────


class TestEstado:
    @pytest.fixture()
    def cache(self, tmp_path, monkeypatch):
        """
        Una caché aislada, igual que en ``test_content_cache``.

        ``reload`` reejecuta el módulo sobre el objeto que ya existe, así que
        todos los que lo importaron —este servicio y el lector— pasan a ver la
        base temporal sin tener que reimportar nada.
        """
        monkeypatch.setenv("CONTENT_CACHE_PATH", str(tmp_path / "content.db"))
        from app.services.jw import content_cache

        modulo = importlib.reload(content_cache)
        yield modulo
        modulo._conn = None

    def test_una_cache_vacia_no_tiene_nada_descargado(self, cache):
        estado = library_status()

        assert estado["total"] == 1189
        assert estado["cached"] == 0
        assert estado["missing"] == 1189
        assert estado["complete"] is False

    def test_cuenta_los_capitulos_guardados(self, cache):
        cache.put("chapter", "43:3", {"verses": []})
        cache.put("chapter", "19:23", {"verses": []})
        # Otros tipos de contenido no cuentan como capítulos bíblicos.
        cache.put("document", "1", {"a": 1})

        estado = library_status()
        assert estado["cached"] == 2
        assert estado["missing"] == 1187

    def test_is_cached_ve_lo_que_guarda_el_lector(self, cache):
        cache.put("chapter", cache_key(43, 3), {"verses": []})

        assert offline_library.is_cached(43, 3) is True
        assert offline_library.is_cached(43, 4) is False

    def test_lo_que_descarga_el_lector_cuenta_como_descargado(self, cache, monkeypatch):
        """
        El contrato crítico de todo el módulo, comprobado de punta a punta.

        Si ``fetch_chapter`` guardara con otra clave, la descarga llenaría la
        caché de entradas que el lector no va a leer nunca y ``is_cached``
        volvería a pedir lo que ya está: horas de red tiradas en silencio. Aquí
        se descarga (con la red simulada) y se comprueba que este módulo lo ve.
        """
        from app.services.references import reference_resolver

        class _RespuestaFalsa:
            # Marcado mínimo con la forma que espera el parser; el texto es de
            # relleno, lo que se está probando es la clave, no el contenido.
            text = '<span class="v" id="v65-1-1-1"><a>1</a> texto de prueba</span>'

            def raise_for_status(self):
                return None

        monkeypatch.setattr(
            reference_resolver.httpx, "get", lambda *a, **k: _RespuestaFalsa()
        )
        reference_resolver._chapter_cache.clear()

        assert offline_library.is_cached(65, 1) is False
        reference_resolver.fetch_chapter("Judas", 1)

        assert offline_library.is_cached(65, 1) is True
        assert library_status()["cached"] == 1


# ─── Búfer de eventos ────────────────────────────────────────────


class TestBufferDeEventos:
    def test_los_eventos_se_numeran_desde_uno(self):
        job = _job([(65, 1)])

        assert (job.append("plan", {}).id, job.append("progress", {}).id) == (1, 2)

    def test_reanudar_desde_el_tres_reemite_del_cuatro(self):
        job = _job([(65, 1)])
        for i in range(6):
            job.append("progress", {"done": i})

        assert [e.id for e in job.since(3)] == [4, 5, 6]

    def test_el_sse_lleva_el_id_para_que_el_navegador_lo_reenvie(self):
        job = _job([(65, 1)])

        sse = job.append("progress", {"done": 2}).to_sse()

        assert sse.startswith("id: 1\nevent: progress\ndata: ")
        assert sse.endswith("\n\n")

    @pytest.mark.asyncio
    async def test_el_stream_reanudado_no_repite_lo_ya_visto(self):
        job = _job([(65, 1)])
        for i in range(3):
            job.append("progress", {"done": i})
        job.append("done", {"cancelled": False, "at": 1001.0})

        trozos = [chunk async for chunk in stream_job(job, last_event_id=2)]

        assert len(trozos) == 2
        assert "id: 3" in trozos[0]

    @pytest.mark.asyncio
    async def test_sin_novedades_se_manda_un_keepalive(self):
        # Los proxies cortan un SSE que lleva rato sin un byte, y con la pausa
        # de cortesía puede pasar un rato largo entre capítulos.
        job = _job([(65, 1)])

        agen = stream_job(job, keepalive=0.01)
        primero = await agen.__anext__()
        await agen.aclose()

        assert primero == ": ping\n\n"


# ─── Router ──────────────────────────────────────────────────────


class TestRouter:
    @pytest.fixture()
    def client(self):
        app = FastAPI()
        app.include_router(offline_router_module.router)
        return TestClient(app)

    def test_el_estado_no_lo_atrapa_la_ruta_comodin(self, client):
        # `/status` se declara antes que `/{job_id}`: si se colaran, la pantalla
        # de ajustes recibiría un 404 en vez del recuento.
        payload = client.get("/api/offline/status").json()

        assert payload["total"] == 1189
        assert "cached" in payload

    def test_el_estado_dice_si_hay_una_descarga_viva(self, client):
        job = get_registry().create([(65, 1)], now=1000.0)

        assert client.get("/api/offline/status").json()["job_id"] == job.job_id

    def test_una_descarga_que_ya_no_existe_da_404(self, client):
        assert client.get("/api/offline/off-no-existe").status_code == 404

    def test_arrancar_devuelve_el_alcance_y_la_estimacion(self, client, monkeypatch):
        # La tarea real no se lanza: lo que se prueba es la respuesta, y
        # arrancarla de verdad saldría a la red desde un test.
        monkeypatch.setattr(offline_router_module, "is_cached", lambda *_: False)
        monkeypatch.setattr(
            offline_router_module,
            "start_job",
            lambda books=None: get_registry().create(chapter_targets(books), now=1000.0),
        )

        payload = client.post(
            "/api/offline/bible/start", json={"books": [63, 64, 65]}
        ).json()

        assert payload["total"] == 3
        assert payload["pending"] == 3
        assert payload["estimated_seconds"] > 0

    def test_un_alcance_sin_libros_validos_da_400(self, client):
        assert (
            client.post("/api/offline/bible/start", json={"books": [999]}).status_code
            == 400
        )

    def test_arrancar_con_una_ya_en_marcha_da_409_con_su_id(self, client):
        job = get_registry().create([(65, 1)], now=1000.0)

        response = client.post("/api/offline/bible/start", json={"books": [63]})

        assert response.status_code == 409
        assert response.headers["X-Offline-Job-Id"] == job.job_id

    def test_cancelar_devuelve_204(self, client):
        job = get_registry().create([(65, 1)], now=1000.0)

        assert client.post(f"/api/offline/{job.job_id}/cancel").status_code == 204
        assert job.cancelled is True

    def test_cancelar_lo_que_no_existe_da_404(self, client):
        assert client.post("/api/offline/off-no/cancel").status_code == 404

    def test_el_stream_reemite_desde_el_last_event_id(self, client):
        job = get_registry().create([(65, 1)], now=1000.0)
        job.append("plan", {"total": 1})
        job.append("progress", {"done": 1})
        job.append("done", {"cancelled": False, "at": 1001.0})

        with client.stream(
            "GET", f"/api/offline/stream/{job.job_id}", headers={"Last-Event-ID": "2"}
        ) as response:
            cuerpo = "".join(response.iter_text())

        assert "event: plan" not in cuerpo
        assert "id: 3" in cuerpo

    def test_el_stream_de_una_descarga_inexistente_da_404(self, client):
        assert client.get("/api/offline/stream/off-no").status_code == 404
