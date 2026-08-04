"""
Offline Library — precarga masiva de la Biblia en la caché de contenido.

**El problema**: ``fetch_chapter`` ya cachea en disco, pero de forma perezosa.
La primera lectura de cada capítulo sale a la red y cuesta entre uno y varios
segundos. Con 1.189 capítulos, el usuario paga esa espera 1.189 veces
repartidas a lo largo de meses, siempre en el peor momento: cuando acaba de
abrir un pasaje y quiere leerlo.

**La solución**: pagarla toda de golpe, una vez, cuando al usuario le da igual
esperar. Este módulo no cachea nada por su cuenta — llama a ``fetch_chapter``,
que es quien escribe en ``content_cache``. Así hay UNA sola forma de la clave
(``kind="chapter"``, ``key=f"{libro}:{capítulo}"``) y un solo parser. Si mañana
cambia el formato del capítulo, no hay dos sitios que arreglar.

**Por qué en segundo plano y con eventos numerados**: descargar la Biblia entera
son decenas de minutos. Eso no cabe en una petición HTTP —cualquier proxy la
corta por inactividad y el móvil la pierde al bloquear la pantalla—, así que el
trabajo vive en el servidor y el cliente se engancha y se desengancha. Es
exactamente el problema de ``research_service``, y se resuelve con su mismo
patrón (``Job`` + ``Registry`` + ``stream_job``) en vez de inventar otro.

**Por qué la concurrencia está limitada y hay una pausa**: esto raspa un sitio
de terceros que no nos debe nada. Mil doscientas peticiones en ráfaga son un
pico de tráfico indistinguible de un ataque, y lo razonable —y lo que evita que
nos bloqueen la IP a mitad de descarga— es ir despacio. Tres en paralelo con un
cuarto de segundo de pausa da unas ocho peticiones por segundo como techo
absoluto, y en la práctica muchísimas menos: medido contra WOL, cada capítulo
tarda unos nueve segundos, así que el ritmo real es de una petición cada tres.
La Biblia entera sale por una hora larga. Es aceptable para algo que se hace
una sola vez y se puede dejar corriendo, y subir la concurrencia para arañar
minutos no compensa el riesgo de que nos corten a mitad.

Los trabajos viven en memoria, con la misma limitación asumida que la
investigación: un redeploy los mata. Aquí duele mucho menos, porque lo ya
descargado está en la caché de disco y relanzar la descarga se salta todo eso.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Dict,
    Iterable,
    Iterator,
    List,
    Optional,
)

from . import content_cache
from .book_numbers import book_display_name, chapter_count

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    """Basura en el entorno degrada al default en vez de tumbar el arranque."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r no es un número. Usando %s.", name, raw, default)
        return default
    return max(minimum, min(value, maximum))


#: Descargas simultáneas. El techo de 4 no es negociable desde el entorno: la
#: cortesía con wol.jw.org no debería poder desactivarse por variable.
OFFLINE_CONCURRENCY = _env_int("OFFLINE_CONCURRENCY", 3, 1, 4)
#: Pausa tras cada petición, por worker. Suaviza la ráfaga aún más.
OFFLINE_DELAY_MS = _env_int("OFFLINE_DELAY_MS", 250, 0, 5000)
#: Cuánto sobrevive un trabajo terminado antes de purgarse.
OFFLINE_JOB_TTL_SECONDS = _env_int("OFFLINE_JOB_TTL_SECONDS", 3600, 300, 21600)
#: Un trabajo vivo a la vez. Dos descargas en paralelo duplicarían el tráfico
#: contra WOL sin acelerar nada: el cuello de botella es el límite de cortesía.
OFFLINE_MAX_LIVE_JOBS = 1

#: Los 66 libros del canon.
_LAST_BOOK = 66

#: Segundos que tarda un capítulo. No es una suposición: son 12 capítulos
#: cronometrados contra WOL (38 s de reloj con la concurrencia de producción,
#: o sea ~9,5 s de latencia cada uno; WOL no es rápido y cada petición abre su
#: propia conexión). Solo alimenta la estimación que ve el usuario, y variará
#: con su red — pero una barra sin ETA no dice si son minutos u horas, y errar
#: por arriba se perdona mientras que prometer quince minutos y tardar una hora
#: no.
_SECONDS_PER_CHAPTER = 9.5

#: El tipo con el que ``reference_resolver`` guarda los capítulos. Se repite
#: aquí en vez de importarlo porque allí es una constante implícita (una cadena
#: literal), y esta duplicación está cubierta por un test que lo comprueba.
_CHAPTER_KIND = "chapter"


def total_chapters() -> int:
    """Capítulos de toda la Biblia (1.189). Constante del canon, no una consulta."""
    return sum(chapter_count(n) for n in range(1, _LAST_BOOK + 1))


def chapter_targets(books: Optional[Iterable[int]] = None) -> List[tuple[int, int]]:
    """
    Pares ``(nº de libro, capítulo)`` en orden canónico.

    Con ``books`` se acota el alcance a unos libros concretos: sirve para
    reintentar solo lo que falló sin volver a recorrer los 1.189.
    """
    numeros = (
        sorted({n for n in books if 1 <= n <= _LAST_BOOK})
        if books is not None
        else list(range(1, _LAST_BOOK + 1))
    )
    return [
        (numero, capitulo)
        for numero in numeros
        for capitulo in range(1, chapter_count(numero) + 1)
    ]


def cache_key(book_number: int, chapter: int) -> str:
    """La clave EXACTA que usa ``fetch_chapter``. Ver el docstring del módulo."""
    return f"{book_number}:{chapter}"


def is_cached(book_number: int, chapter: int) -> bool:
    """¿Está ya ese capítulo en disco? Lo que permite no pedir lo que ya hay."""
    return content_cache.get(_CHAPTER_KIND, cache_key(book_number, chapter)) is not None


def library_status() -> Dict[str, Any]:
    """
    Cuántos capítulos hay descargados de los 1.189.

    Se cuenta con ``content_cache.stats()`` —una sola consulta agregada— en vez
    de preguntar capítulo a capítulo: 1.189 lecturas suponen deserializar unos
    seis megas de JSON para acabar respondiendo un número, y esto lo consulta la
    pantalla de ajustes cada vez que se abre. El recuento es exacto porque
    ``kind="chapter"`` solo lo escribe ``fetch_chapter``, y solo con capítulos
    bíblicos.
    """
    total = total_chapters()
    stats = content_cache.stats()
    entrada = stats.get("entries", {}).get(_CHAPTER_KIND, {})
    cacheados = min(int(entrada.get("count", 0) or 0), total)

    return {
        "total": total,
        "cached": cacheados,
        "missing": total - cacheados,
        "complete": cacheados >= total,
        "bytes": int(entrada.get("bytes", 0) or 0),
        "cache_available": bool(stats.get("available", False)),
    }


def estimated_seconds(pending: int) -> int:
    """
    Estimación honesta para la interfaz, en segundos.

    Cada worker gasta lo que tarda la petición más la pausa de cortesía, y hay
    ``OFFLINE_CONCURRENCY`` a la vez. Se redondea hacia arriba: prometer de más
    y cumplir antes se perdona; lo contrario no.
    """
    if pending <= 0:
        return 0
    por_capitulo = _SECONDS_PER_CHAPTER + OFFLINE_DELAY_MS / 1000
    return max(1, int(pending * por_capitulo / OFFLINE_CONCURRENCY + 0.999))


# ─── Trabajos ────────────────────────────────────────────────────


@dataclass(frozen=True)
class DownloadEvent:
    """Un evento numerado. El número es lo que permite reanudar."""

    id: int
    event: str
    data: Dict[str, Any]

    def to_sse(self) -> str:
        return (
            f"id: {self.id}\n"
            f"event: {self.event}\n"
            f"data: {json.dumps(self.data, ensure_ascii=False)}\n\n"
        )


@dataclass
class DownloadJob:
    """Una descarga en curso, con su búfer de eventos."""

    job_id: str
    targets: List[tuple[int, int]] = field(default_factory=list)
    """Todo el alcance, incluidos los que ya estaban cacheados."""
    created_at: float = 0.0
    finished_at: Optional[float] = None
    cancelled: bool = False
    #: Capítulos que ya estaban en disco y no se han pedido.
    skipped: int = 0
    #: Capítulos descargados en esta sesión.
    downloaded: int = 0
    #: Los que fallaron, con su motivo. Un capítulo roto no aborta la descarga.
    failures: List[Dict[str, Any]] = field(default_factory=list)
    #: Lo último que se estaba descargando, para la etiqueta de la interfaz.
    current_label: str = ""
    events: List[DownloadEvent] = field(default_factory=list)
    task: Optional["asyncio.Task[None]"] = None
    _signal: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def finished(self) -> bool:
        return self.finished_at is not None

    @property
    def total(self) -> int:
        return len(self.targets)

    @property
    def processed(self) -> int:
        """Capítulos resueltos de una u otra forma: saltados, hechos o fallidos."""
        return self.skipped + self.downloaded + len(self.failures)

    def append(self, event: str, data: Dict[str, Any]) -> DownloadEvent:
        entry = DownloadEvent(len(self.events) + 1, event, data)
        self.events.append(entry)
        if event == "done":
            # El reloj de cierre se toma del propio evento cuando el llamante lo
            # trae: así el trabajo entero se puede probar sin depender de la hora.
            self.finished_at = float(data.get("at", time.time()))
        self._signal.set()
        return entry

    def since(self, last_event_id: int) -> List[DownloadEvent]:
        """Los eventos posteriores a ``last_event_id``. La reanudación."""
        return [entry for entry in self.events if entry.id > last_event_id]

    def mark_read(self) -> None:
        """Se llama ANTES de leer el búfer para no perder un evento nuevo."""
        self._signal.clear()

    async def wait_for_change(self, timeout: float) -> None:
        try:
            await asyncio.wait_for(self._signal.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return

    def progress(self, now: Optional[float] = None) -> Dict[str, Any]:
        """El progreso tal cual lo pinta la interfaz."""
        momento = now if now is not None else time.time()
        return {
            "done": self.processed,
            "total": self.total,
            "downloaded": self.downloaded,
            "skipped": self.skipped,
            "failed": len(self.failures),
            "label": self.current_label,
            "elapsed_ms": int(
                max(0.0, (self.finished_at or momento) - self.created_at) * 1000
            ),
        }

    def snapshot(self, now: Optional[float] = None) -> Dict[str, Any]:
        """Estado completo para el polling de respaldo."""
        return {
            "job_id": self.job_id,
            "finished": self.finished,
            "cancelled": self.cancelled,
            "last_event_id": self.events[-1].id if self.events else 0,
            "failures": list(self.failures),
            **self.progress(now),
        }


class JobLimitReached(Exception):
    """Ya hay una descarga en marcha."""


class DownloadRegistry:
    """Registro de descargas en memoria, con tope y purga por antigüedad."""

    def __init__(self) -> None:
        self._jobs: Dict[str, DownloadJob] = {}
        self._counter = 0

    def _next_id(self, now: float) -> str:
        self._counter += 1
        return f"off-{int(now)}-{self._counter:04d}"

    def purge(self, now: Optional[float] = None) -> int:
        """Elimina los terminados que ya pasaron su TTL. Devuelve cuántos."""
        momento = now if now is not None else time.time()
        expirados = [
            job_id
            for job_id, job in self._jobs.items()
            if job.finished_at is not None
            and momento - job.finished_at > OFFLINE_JOB_TTL_SECONDS
        ]
        for job_id in expirados:
            self._jobs.pop(job_id, None)
        return len(expirados)

    def live_count(self) -> int:
        return sum(1 for job in self._jobs.values() if not job.finished)

    def live_job(self) -> Optional[DownloadJob]:
        """La descarga en curso, si la hay. La interfaz la usa para reengancharse."""
        for job in self._jobs.values():
            if not job.finished:
                return job
        return None

    def create(
        self,
        targets: List[tuple[int, int]],
        now: Optional[float] = None,
    ) -> DownloadJob:
        momento = now if now is not None else time.time()
        self.purge(momento)
        if self.live_count() >= OFFLINE_MAX_LIVE_JOBS:
            raise JobLimitReached("Ya hay una descarga en marcha.")
        job = DownloadJob(
            job_id=self._next_id(momento),
            targets=list(targets),
            created_at=momento,
        )
        self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Optional[DownloadJob]:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str, now: Optional[float] = None) -> bool:
        """
        Para la descarga. Lo ya bajado se queda; cancelar nunca tira trabajo.

        Comprobado en vivo: las peticiones que estaban en vuelo al cancelar
        terminan igualmente y acaban en la caché, porque viven en un hilo y a un
        hilo no se le puede quitar el trabajo de las manos. Por eso el contador
        del trabajo puede quedarse por debajo de lo que hay realmente en disco:
        la verdad de "cuánto tengo descargado" es ``library_status()``, no este
        trabajo.
        """
        job = self._jobs.get(job_id)
        if job is None or job.finished:
            return False
        momento = now if now is not None else time.time()
        job.cancelled = True
        if job.task is not None:
            job.task.cancel()
        # El `done` se emite AQUÍ y no se delega al worker: la tarea cancelada
        # puede morir sin volver a pasar por el bucle, y un cliente esperando un
        # `done` que no llega se queda con la barra girando para siempre.
        job.append("done", {"cancelled": True, "at": momento, **job.progress(momento)})
        return True

    def clear(self) -> None:
        """Solo para los tests."""
        self._jobs.clear()
        self._counter = 0


_registry = DownloadRegistry()


def get_registry() -> DownloadRegistry:
    return _registry


# ─── Motor ───────────────────────────────────────────────────────


async def _fetch_chapter_async(book_number: int, chapter: int) -> None:
    """
    Descarga un capítulo delegando en ``fetch_chapter``, que es quien cachea.

    El import es perezoso porque ``references`` importa de ``jw`` (para la
    caché y los números de libro): al revés y a nivel de módulo sería un ciclo.
    Va a un hilo porque ``fetch_chapter`` usa ``httpx.get`` síncrono y bloquear
    el bucle dejaría clavada la app entera durante toda la descarga.
    """
    from ..references.reference_resolver import fetch_chapter

    await asyncio.to_thread(fetch_chapter, book_display_name(book_number), chapter)


#: Firma de la función que descarga un capítulo. Inyectable para poder probar
#: el motor entero sin tocar la red.
Fetcher = Callable[[int, int], Awaitable[None]]
Sleeper = Callable[[float], Awaitable[None]]
Clock = Callable[[], float]


async def _worker(
    job: DownloadJob,
    pendientes: "Iterator[tuple[int, int]]",
    fetch: Fetcher,
    sleep: Sleeper,
    clock: Clock,
    delay: float,
) -> None:
    """
    Un hilo de descarga. Consume del iterador compartido hasta agotarlo.

    ``next()`` sobre un iterador compartido es seguro aquí porque no hay ningún
    ``await`` entre sacar el elemento y usarlo: en un único bucle de eventos,
    eso es atómico. Es más simple que una cola y hace la misma función.
    """
    while True:
        if job.cancelled:
            return
        try:
            book_number, chapter = next(pendientes)
        except StopIteration:
            return

        etiqueta = f"{book_display_name(book_number)} {chapter}"
        job.current_label = etiqueta

        try:
            await fetch(book_number, chapter)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            # Tolerancia a fallos: un capítulo que WOL sirve mal, o un corte de
            # red de dos segundos, no puede tirar cuarenta minutos de descarga.
            # Se anota y se sigue; al final se le dice al usuario qué faltó.
            logger.warning("No se pudo descargar %s: %s", etiqueta, exc)
            job.failures.append(
                {"book": book_number, "chapter": chapter, "label": etiqueta}
            )
        else:
            job.downloaded += 1

        job.append("progress", job.progress(clock()))

        # La pausa va DESPUÉS de contabilizar y siempre, haya ido bien o mal:
        # si el fallo fue por saturar a WOL, insistir sin pausa lo empeora.
        if delay > 0:
            await sleep(delay)


async def run_download(
    job: DownloadJob,
    fetch: Optional[Fetcher] = None,
    sleep: Sleeper = asyncio.sleep,
    clock: Clock = time.time,
    cached: Optional[Callable[[int, int], bool]] = None,
    concurrency: int = OFFLINE_CONCURRENCY,
    delay: Optional[float] = None,
) -> None:
    """
    Ejecuta la descarga completa, volcando todo al búfer del trabajo.

    No lanza nunca: cualquier fallo global se convierte en un ``event: error``
    seguido de un ``event: done``. Un trabajo que muere en silencio deja al
    cliente esperando para siempre.

    Todo lo que depende del mundo exterior —la red, el reloj, la pausa, la
    caché— entra por parámetro para que el motor se pueda probar entero sin
    red y sin esperas reales.
    """
    descargar = fetch or _fetch_chapter_async
    esta_cacheado = cached or is_cached
    espera = OFFLINE_DELAY_MS / 1000 if delay is None else delay

    try:
        # Saltarse lo ya descargado es lo que hace que relanzar sea barato: tras
        # un corte a mitad, la segunda pasada solo pide lo que falta.
        pendientes: List[tuple[int, int]] = []
        for book_number, chapter in job.targets:
            if esta_cacheado(book_number, chapter):
                job.skipped += 1
            else:
                pendientes.append((book_number, chapter))

        job.append(
            "plan",
            {
                "total": job.total,
                "pending": len(pendientes),
                "skipped": job.skipped,
                "estimated_seconds": estimated_seconds(len(pendientes)),
            },
        )

        if pendientes and not job.cancelled:
            iterador = iter(pendientes)
            workers = [
                _worker(job, iterador, descargar, sleep, clock, espera)
                for _ in range(max(1, min(concurrency, len(pendientes))))
            ]
            await asyncio.gather(*workers)

        if job.cancelled:
            # cancel() ya emitió el `done`; no hay nada más que decir.
            return

        momento = clock()
        job.append(
            "report",
            {
                "downloaded": job.downloaded,
                "skipped": job.skipped,
                "failures": list(job.failures),
                **library_status(),
            },
        )
        job.append(
            "done", {"cancelled": False, "at": momento, **job.progress(momento)}
        )

    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("La descarga sin conexión ha fallado")
        momento = clock()
        job.append("error", {"message": "La descarga ha fallado"})
        job.append(
            "done", {"cancelled": False, "at": momento, **job.progress(momento)}
        )


def start_job(books: Optional[Iterable[int]] = None) -> DownloadJob:
    """Crea el trabajo y lanza su tarea. Puede lanzar ``JobLimitReached``."""
    job = get_registry().create(chapter_targets(books))
    job.task = asyncio.create_task(run_download(job))
    return job


async def stream_job(
    job: DownloadJob, last_event_id: int = 0, keepalive: float = 15.0
) -> AsyncGenerator[str, None]:
    """
    SSE de un trabajo, reanudable.

    ``Last-Event-ID: 7`` reemite desde el 8. El orden importa: se marca leído
    ANTES de vaciar el búfer, para que un evento que llegue justo en medio
    despierte igualmente la espera en vez de costar un ciclo de keepalive.
    """
    cursor = max(0, last_event_id)

    while True:
        job.mark_read()
        for entry in job.since(cursor):
            cursor = entry.id
            yield entry.to_sse()

        if job.finished and not job.since(cursor):
            return

        await job.wait_for_change(keepalive)
        if not job.since(cursor) and not job.finished:
            yield ": ping\n\n"


__all__ = [
    "DownloadEvent",
    "DownloadJob",
    "DownloadRegistry",
    "JobLimitReached",
    "OFFLINE_CONCURRENCY",
    "OFFLINE_DELAY_MS",
    "OFFLINE_JOB_TTL_SECONDS",
    "OFFLINE_MAX_LIVE_JOBS",
    "cache_key",
    "chapter_targets",
    "estimated_seconds",
    "get_registry",
    "is_cached",
    "library_status",
    "run_download",
    "start_job",
    "stream_job",
    "total_chapters",
]
