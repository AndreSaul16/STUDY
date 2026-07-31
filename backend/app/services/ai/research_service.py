"""
Research service — investigación profunda con motor propio.

**Por qué motor propio y no el deep research del proveedor** (decisión, no
preferencia): el valor de STUDY es investigar *en las publicaciones* y
responder con la voz del usuario. El deep research de Google no permite
restringir la búsqueda por dominio, así que devolvería la web abierta — es
descalificante. Además el coste propio es de 0,05-0,30 $ por informe frente a
1,50-8,00 $, y el tiempo (2-5 minutos) es controlable en vez de estar entre 10
y 60. La API del proveedor queda como refuerzo opcional, sin implementar.

Cuatro fases:

1. **PLAN** — una llamada corta sin herramientas que descompone el tema en 4-7
   sub-preguntas. Parseo defensivo: un plan inválido cae a un plan de respaldo,
   nunca tumba el trabajo.
2. **INVESTIGACIÓN** — el bucle de herramientas de siempre, con presupuestos
   ampliados y la sub-pregunta activa inyectada como mensaje de sistema.
   Reutiliza ``tool_cache_key`` (crítico: sin caché se vuelve a raspar el mismo
   documento en cada sub-pregunta, a ~20 s cada vez), ``SourceTracker`` y
   ``research_gap``.
3. **CIERRE DE BRECHAS** — las sub-preguntas sin ninguna fuente se anotan y
   acaban en la sección "Lo que no encontré" del informe.
4. **SÍNTESIS** — respuesta final en streaming, sin herramientas, con el
   esfuerzo que haya elegido el usuario (ahí sí se puede: no hay ``tools``).

**Los trabajos viven en memoria.** Un redeploy de Railway los mata; es una
limitación asumida y comunicada. La mitigación está en el cliente: cada evento
va NUMERADO, el cliente los persiste y ofrece "Reanudar" si el trabajo
desaparece. Ninguna investigación se pierde entera.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Optional

from .chat_modes import ModeSpec, get_mode
from .chat_providers import ChatRuntime, tool_choice_for
from .redaction import redact
from .research_policy import (
    budget_exhausted,
    executed_tool_names,
    research_gap,
    tool_cache_key,
)
from .source_tracker import SourceTracker

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


#: Rondas de herramientas de TODA la investigación (no por sub-pregunta).
RESEARCH_MAX_TOOL_ROUNDS = _env_int("RESEARCH_MAX_TOOL_ROUNDS", 14, 4, 30)
#: Presupuesto de tiempo de la fase de investigación.
RESEARCH_BUDGET_SECONDS = _env_int("RESEARCH_BUDGET_SECONDS", 300, 60, 1800)
#: Documentos distintos que se abren como máximo.
RESEARCH_MAX_DOCS = _env_int("RESEARCH_MAX_DOCS", 12, 3, 30)
#: Cuánto sobrevive un trabajo terminado antes de purgarse.
RESEARCH_JOB_TTL_SECONDS = _env_int("RESEARCH_JOB_TTL_SECONDS", 3600, 300, 21600)
#: Trabajos vivos a la vez. Cada uno son minutos de CPU y dinero.
RESEARCH_MAX_LIVE_JOBS = _env_int("RESEARCH_MAX_LIVE_JOBS", 4, 1, 16)

#: Sub-preguntas del plan.
_MIN_PLAN_ITEMS = 3
_MAX_PLAN_ITEMS = 7

_PLAN_PROMPT = (
    "Descompón la petición del usuario en {n} sub-preguntas de investigación, "
    "concretas y complementarias, que haya que resolver consultando las "
    "publicaciones. Devuelve SOLO un array JSON de cadenas, sin numeración y "
    "sin texto fuera del array."
)

_SUBQUESTION_SYSTEM = (
    "Sub-pregunta {index} de {total} de la investigación: «{question}». "
    "Consulta las fuentes necesarias para responderla. No redactes todavía el "
    "informe: ahora solo investigas."
)

_SYNTHESIS_SYSTEM = (
    "Ya has terminado de investigar. Redacta ahora el informe completo con el "
    "formato del modo. Sub-preguntas sin ninguna fuente encontrada: {gaps}. "
    "Esas van en la sección «Lo que no encontré»."
)


# ─── Plan ────────────────────────────────────────────────────────


def fallback_plan(question: str) -> List[str]:
    """
    Plan de respaldo cuando el modelo no devuelve un JSON usable.

    Genérico a propósito: es mejor investigar con un plan mediocre que
    quedarse sin investigar por un fallo de formato.
    """
    tema = " ".join((question or "").split())[:120] or "el tema propuesto"
    return [
        f"¿Qué enseñan las publicaciones sobre {tema}?",
        f"¿Qué pasajes bíblicos se citan al hablar de {tema}?",
        f"¿Qué ejemplos o relatos se usan para ilustrar {tema}?",
        f"¿Cómo se aplica {tema} en la vida diaria?",
    ]


def parse_plan(raw: str, question: str) -> List[str]:
    """
    Parseo defensivo del plan. Mismo criterio que ``parse_followups``.

    Acepta un array JSON con o sin valla de markdown alrededor. Cualquier otra
    cosa cae al plan de respaldo: el formato del plan no puede ser un punto de
    fallo de una tarea de cinco minutos.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[: -len("```")]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return fallback_plan(question)

    if not isinstance(parsed, list):
        return fallback_plan(question)

    items = [item.strip() for item in parsed if isinstance(item, str) and item.strip()]
    if len(items) < _MIN_PLAN_ITEMS:
        return fallback_plan(question)
    return items[:_MAX_PLAN_ITEMS]


def estimated_seconds(plan_size: int = _MAX_PLAN_ITEMS) -> int:
    """Estimación honesta para la interfaz: ~40 s por sub-pregunta, acotada."""
    return max(60, min(plan_size * 40, RESEARCH_BUDGET_SECONDS))


# ─── Trabajos ────────────────────────────────────────────────────


@dataclass(frozen=True)
class ResearchEvent:
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
class ResearchJob:
    """Una investigación en curso, con su búfer de eventos."""

    job_id: str
    question: str
    mode_id: str
    conversation_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancelled: bool = False
    plan: List[str] = field(default_factory=list)
    answer: str = ""
    events: List[ResearchEvent] = field(default_factory=list)
    task: Optional["asyncio.Task[None]"] = None
    _signal: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def finished(self) -> bool:
        return self.finished_at is not None

    def append(self, event: str, data: Dict[str, Any]) -> ResearchEvent:
        entry = ResearchEvent(len(self.events) + 1, event, data)
        self.events.append(entry)
        if event == "done":
            self.finished_at = time.time()
        self._signal.set()
        return entry

    def since(self, last_event_id: int) -> List[ResearchEvent]:
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

    def snapshot(self) -> Dict[str, Any]:
        """Estado completo para el polling de respaldo."""
        return {
            "job_id": self.job_id,
            "question": self.question,
            "mode": self.mode_id,
            "conversation_id": self.conversation_id,
            "plan": list(self.plan),
            "finished": self.finished,
            "cancelled": self.cancelled,
            "answer": self.answer,
            "last_event_id": self.events[-1].id if self.events else 0,
            "elapsed_ms": int(
                ((self.finished_at or time.time()) - self.created_at) * 1000
            ),
        }


class JobLimitReached(Exception):
    """Ya hay demasiadas investigaciones vivas."""


class ResearchRegistry:
    """Registro de trabajos en memoria, con tope y purga por antigüedad."""

    def __init__(self) -> None:
        self._jobs: Dict[str, ResearchJob] = {}
        self._counter = 0

    def _next_id(self) -> str:
        self._counter += 1
        return f"rs-{int(time.time())}-{self._counter:04d}"

    def purge(self, now: Optional[float] = None) -> int:
        """Elimina los terminados que ya pasaron su TTL. Devuelve cuántos."""
        moment = now if now is not None else time.time()
        expirados = [
            job_id
            for job_id, job in self._jobs.items()
            if job.finished_at is not None
            and moment - job.finished_at > RESEARCH_JOB_TTL_SECONDS
        ]
        for job_id in expirados:
            self._jobs.pop(job_id, None)
        return len(expirados)

    def live_count(self) -> int:
        return sum(1 for job in self._jobs.values() if not job.finished)

    def create(
        self, question: str, mode_id: str, conversation_id: Optional[str] = None
    ) -> ResearchJob:
        self.purge()
        if self.live_count() >= RESEARCH_MAX_LIVE_JOBS:
            raise JobLimitReached(
                "Ya hay varias investigaciones en marcha. Espera a que terminen."
            )
        job = ResearchJob(
            job_id=self._next_id(),
            question=question,
            mode_id=mode_id,
            conversation_id=conversation_id,
        )
        self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Optional[ResearchJob]:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if job is None or job.finished:
            return False
        job.cancelled = True
        if job.task is not None:
            job.task.cancel()
        job.append("done", {"cancelled": True, "elapsed_ms": 0})
        return True

    def clear(self) -> None:
        """Solo para los tests."""
        self._jobs.clear()
        self._counter = 0


_registry = ResearchRegistry()


def get_registry() -> ResearchRegistry:
    return _registry


# ─── Motor ───────────────────────────────────────────────────────


async def _plan_subquestions(
    runtime: ChatRuntime, question: str, messages: List[Dict[str, Any]]
) -> List[str]:
    """Llamada corta sin herramientas. Un fallo aquí NO aborta el trabajo."""
    try:
        response = await runtime.client.chat.completions.create(
            model=runtime.model,
            messages=[
                *messages,
                {"role": "user", "content": _PLAN_PROMPT.format(n=_MAX_PLAN_ITEMS - 1)},
            ],
            max_completion_tokens=500,
            **runtime.tool_params,
        )
    except Exception as exc:
        logger.warning("No se pudo planificar la investigación: %s", redact(exc))
        return fallback_plan(question)

    return parse_plan(response.choices[0].message.content or "", question)


async def run_research(
    job: ResearchJob,
    service: Any,
    runtime: ChatRuntime,
    messages: List[Dict[str, Any]],
    mode: Optional[str] = None,
) -> None:
    """
    Ejecuta la investigación completa, volcando todo al búfer del trabajo.

    No lanza nunca: cualquier fallo se convierte en un ``event: error`` seguido
    de un ``event: done``. Un trabajo que muere en silencio deja al cliente
    esperando para siempre.
    """
    started = time.time()
    mode_spec: ModeSpec = get_mode(mode or job.mode_id)

    try:
        await service.ensure_tools()

        from .chat_service import build_system_prompt  # evita el import circular

        full_messages: List[Dict[str, Any]] = [
            {"role": "system", "content": build_system_prompt(mode_spec)}
        ] + list(messages)

        # ── 1. PLAN ──────────────────────────────────────────────
        plan = await _plan_subquestions(runtime, job.question, full_messages)
        job.plan = plan
        job.append(
            "plan",
            {
                "items": [
                    {"id": i + 1, "question": q} for i, q in enumerate(plan)
                ],
                "budget_seconds": RESEARCH_BUDGET_SECONDS,
            },
        )

        # ── 2. INVESTIGACIÓN ─────────────────────────────────────
        tracker = SourceTracker()
        tool_cache: Dict[str, str] = {}
        docs_read = 0
        rounds = 0
        gaps: List[str] = []

        # Reparto POR SUB-PREGUNTA y no un bote común. Con un solo contador
        # global, la primera sub-pregunta se comía todas las rondas y las demás
        # entraban con la condición ya falsa: se marcaban hechas sin haber
        # consultado nada, y el informe hablaba solo del primer punto del plan.
        # El tope global sigue existiendo: acota el coste, no el reparto.
        per_question = max(2, RESEARCH_MAX_TOOL_ROUNDS // max(1, len(plan)))

        for index, subquestion in enumerate(plan, start=1):
            if job.cancelled:
                break
            if budget_exhausted(started, RESEARCH_BUDGET_SECONDS, time.time()):
                gaps.extend(plan[index - 1 :])
                break

            job.append(
                "progress",
                {
                    "step": index,
                    "total": len(plan),
                    "label": subquestion,
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "docs": docs_read,
                },
            )

            full_messages.append(
                {
                    "role": "system",
                    "content": _SUBQUESTION_SYSTEM.format(
                        index=index, total=len(plan), question=subquestion
                    ),
                }
            )

            before = len(tracker.sources())
            force = True
            q_rounds = 0
            while q_rounds < per_question and rounds < RESEARCH_MAX_TOOL_ROUNDS:
                if budget_exhausted(started, RESEARCH_BUDGET_SECONDS, time.time()):
                    break
                rounds += 1
                q_rounds += 1

                try:
                    response = await runtime.client.chat.completions.create(
                        model=runtime.model,
                        messages=full_messages,
                        tools=service.tools,
                        tool_choice=tool_choice_for(runtime.provider, force),
                        max_completion_tokens=2000,
                        **runtime.tool_params,
                    )
                except Exception as exc:
                    logger.error("Ronda de investigación fallida: %s", redact(exc))
                    break
                force = False

                message = response.choices[0].message
                calls = message.tool_calls or []
                if not calls:
                    break

                full_messages.append(
                    {
                        "role": "assistant",
                        "content": message.content,
                        "tool_calls": [
                            {
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.function.name,
                                    "arguments": call.function.arguments or "{}",
                                },
                            }
                            for call in calls
                        ],
                    }
                )

                for call in calls:
                    name = call.function.name
                    try:
                        args = json.loads(call.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}

                    key = tool_cache_key(name, args)
                    content = tool_cache.get(key)
                    if content is None:
                        if docs_read >= RESEARCH_MAX_DOCS:
                            content = json.dumps(
                                {"error": "límite de documentos alcanzado"}
                            )
                        else:
                            content = await service._run_tool(name, args)
                            docs_read += 1
                        tool_cache[key] = content

                    try:
                        parsed = json.loads(content)
                    except (json.JSONDecodeError, TypeError):
                        parsed = {}
                    tracker.record(name, args, parsed)

                    full_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": content,
                        }
                    )

                    job.append(
                        "progress",
                        {
                            "step": index,
                            "total": len(plan),
                            "label": tracker.summary(name, parsed) or name,
                            "elapsed_ms": int((time.time() - started) * 1000),
                            "docs": docs_read,
                        },
                    )

            # ── 3. CIERRE DE BRECHAS ─────────────────────────────
            if len(tracker.sources()) == before:
                gaps.append(subquestion)

        if job.cancelled:
            return

        sources = tracker.sources()
        job.append("sources", {"items": sources})

        # Una última comprobación de la política de investigación de siempre.
        pendiente = research_gap(executed_tool_names(full_messages), mode_spec)
        if pendiente:
            full_messages.append({"role": "system", "content": pendiente})

        # ── 4. SÍNTESIS ──────────────────────────────────────────
        full_messages.append(
            {
                "role": "system",
                "content": _SYNTHESIS_SYSTEM.format(
                    gaps="; ".join(gaps) if gaps else "ninguna"
                ),
            }
        )

        answer = ""
        try:
            stream = await runtime.client.chat.completions.create(
                model=runtime.model,
                messages=full_messages,
                max_completion_tokens=mode_spec.max_tokens,
                stream=True,
                stream_options={"include_usage": True},
                **runtime.answer_params,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    answer += delta.content
                    job.append("token", {"text": delta.content})
        except Exception as exc:
            logger.error("Síntesis fallida: %s", redact(exc))
            job.append("error", {"message": "Error al redactar el informe"})

        job.answer = answer
        job.append(
            "metadata",
            {"tool_calls": rounds, "mode": mode_spec.id, **runtime.metadata()},
        )
        job.append(
            "report",
            {
                "docs": docs_read,
                "sources": len(sources),
                "gaps": gaps,
                "elapsed_ms": int((time.time() - started) * 1000),
            },
        )
        job.append(
            "done",
            {
                "total_tokens": 0,
                "elapsed_ms": int((time.time() - started) * 1000),
                "cancelled": False,
            },
        )

    except asyncio.CancelledError:
        # cancel() ya emitió el `done`; aquí solo se sale limpio.
        raise
    except Exception as exc:
        logger.exception("Investigación fallida: %s", redact(exc))
        job.append("error", {"message": "La investigación ha fallado"})
        job.append(
            "done",
            {
                "total_tokens": 0,
                "elapsed_ms": int((time.time() - started) * 1000),
                "cancelled": False,
            },
        )


def start_job(
    service: Any,
    runtime: ChatRuntime,
    messages: List[Dict[str, Any]],
    mode: Optional[str],
    conversation_id: Optional[str] = None,
) -> ResearchJob:
    """Crea el trabajo y lanza su tarea. Puede lanzar ``JobLimitReached``."""
    question = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            question = str(message.get("content") or "")
            break

    job = get_registry().create(question, get_mode(mode).id, conversation_id)
    job.task = asyncio.create_task(run_research(job, service, runtime, messages, mode))
    return job


async def stream_job(
    job: ResearchJob, last_event_id: int = 0, keepalive: float = 15.0
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
        pendientes = job.since(cursor)
        for entry in pendientes:
            cursor = entry.id
            yield entry.to_sse()

        if job.finished and not job.since(cursor):
            return

        await job.wait_for_change(keepalive)
        if not job.since(cursor) and not job.finished:
            yield ": ping\n\n"


__all__ = [
    "JobLimitReached",
    "RESEARCH_BUDGET_SECONDS",
    "RESEARCH_JOB_TTL_SECONDS",
    "RESEARCH_MAX_DOCS",
    "RESEARCH_MAX_LIVE_JOBS",
    "RESEARCH_MAX_TOOL_ROUNDS",
    "ResearchEvent",
    "ResearchJob",
    "ResearchRegistry",
    "estimated_seconds",
    "fallback_plan",
    "get_registry",
    "parse_plan",
    "run_research",
    "start_job",
    "stream_job",
]
