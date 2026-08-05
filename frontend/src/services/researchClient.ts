/**
 * researchClient — seguimiento de una investigación profunda.
 *
 * Un informe tarda minutos. El trabajo vive en el servidor y el cliente se
 * engancha y se desengancha: se puede cerrar la app y volver.
 *
 * `followJob` reconecta sola tras un corte, mandando `Last-Event-ID` con el
 * último evento visto, así que reanudar no cuesta ni un evento repetido ni una
 * investigación repetida. Si el trabajo ya no existe (redeploy de Railway →
 * 404) llama a `onGone` y la interfaz ofrece relanzarlo.
 */

import { API_BASE } from "@/services/apiBase";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";
import type { ParsedSSEEvent } from "@/utils/sse";

const RESEARCH_BASE = `${API_BASE}/api/research`;

/** Reintentos de reconexión antes de rendirse. */
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2000;

/**
 * Espera a que la pestaña vuelva a estar visible.
 *
 * **Por qué hace falta.** Los navegadores suspenden las pestañas en segundo
 * plano: la conexión SSE se corta sola y los reintentos se ejecutan contra una
 * pestaña dormida, así que fallan de inmediato. Con tres intentos y dos
 * segundos de espera, el presupuesto entero se consumía en seis segundos —
 * mucho antes de que el usuario volviera— y al regresar se encontraba la
 * investigación dada por muerta. Y no lo estaba: el trabajo seguía vivo en el
 * servidor, porque este camino no cancela nada.
 *
 * Reintentar escondido no sirve de nada, así que se espera. Un trabajo de
 * cinco minutos tiene que sobrevivir a que mires el correo.
 */
function esperarAVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();

  return new Promise((resolve) => {
    const listo = () => {
      document.removeEventListener("visibilitychange", alCambiar);
      signal?.removeEventListener("abort", listo);
      resolve();
    };
    const alCambiar = () => {
      if (!document.hidden) listo();
    };
    document.addEventListener("visibilitychange", alCambiar);
    signal?.addEventListener("abort", listo, { once: true });
  });
}

/**
 * ¿El trabajo sigue existiendo y sin terminar en el SERVIDOR?
 *
 * Se pregunta ANTES de rendirse. Agotar los reintentos solo significa que el
 * cliente no consigue engancharse —una pestaña dormida, un túnel, un wifi que
 * baila—, y eso no es que la investigación haya muerto: el trabajo vive en el
 * backend y nadie lo cancela por aquí. Declararla muerta sin comprobarlo es lo
 * que hacía que volver a la pestaña te encontrases el informe abortado con el
 * servidor todavía trabajando.
 *
 * Un 404 (el trabajo ya no está) o un fallo de la propia comprobación sí
 * cierran: ahí no hay nada que esperar.
 */
async function sigueVivo(jobId: string): Promise<boolean> {
  const snapshot = await fetchSnapshot(jobId);
  return snapshot !== null && !snapshot.finished;
}

export interface FollowJobOptions {
  jobId: string;
  lastEventId?: number;
  signal?: AbortSignal;
  onEvent: (event: ParsedSSEEvent) => void;
  onGone: () => void;
  onError: (message: string) => void;
}

export async function followJob({
  jobId,
  lastEventId = 0,
  signal,
  onEvent,
  onGone,
  onError,
}: FollowJobOptions): Promise<void> {
  let cursor = lastEventId;
  let attempts = 0;

  while (!signal?.aborted) {
    try {
      const response = await fetch(`${RESEARCH_BASE}/stream/${jobId}`, {
        headers: {
          Accept: "text/event-stream",
          ...(cursor > 0 ? { "Last-Event-ID": String(cursor) } : {}),
        },
        signal,
      });

      if (response.status === 404) {
        onGone();
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      // El contador se pone a cero cuando llega ALGO, no con el 200. Si se
      // reseteara con la respuesta, una conexión que abre y cierra en vacío lo
      // dejaría siempre en 1 y el tope de reintentos nunca se alcanzaría.
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSSEEvents(buffer);
        buffer = rest;

        for (const raw of events) {
          const parsed = parseSSEEvent(raw);
          if (!parsed) continue;
          if (typeof parsed.id === "number") cursor = parsed.id;
          received += 1;
          onEvent(parsed);
          if (parsed.event === "done") finished = true;
        }
      }

      if (received > 0) attempts = 0;

      if (finished || signal?.aborted) return;

      // El servidor cerró sin `done`. Cuenta como intento igual que un error
      // de red: `stream_job` cierra limpiamente cuando el trabajo ya terminó y
      // el cursor está al día, así que sin frenar aquí el cliente reconecta en
      // bucle cerrado —sin espera y sin tope— contra un trabajo que jamás va a
      // emitir nada más.
      attempts += 1;
      if (attempts > MAX_RECONNECTS && !(await sigueVivo(jobId))) {
        onError("La investigación dejó de enviar datos.");
        return;
      }
      if (attempts > MAX_RECONNECTS) attempts = 0;
      await esperarAVisible(signal);
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    } catch (error) {
      if (signal?.aborted) return;
      attempts += 1;
      if (attempts > MAX_RECONNECTS && !(await sigueVivo(jobId))) {
        onError(
          error instanceof Error
            ? `Se perdió la conexión con la investigación (${error.message}).`
            : "Se perdió la conexión con la investigación.",
        );
        return;
      }
      if (attempts > MAX_RECONNECTS) attempts = 0;
      await esperarAVisible(signal);
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  }
}

export interface ResearchSnapshot {
  job_id: string;
  question: string;
  plan: string[];
  finished: boolean;
  cancelled: boolean;
  answer: string;
  last_event_id: number;
  elapsed_ms: number;
}

/** Instantánea JSON. Respaldo donde el SSE no llega, y test de existencia. */
export async function fetchSnapshot(
  jobId: string,
): Promise<ResearchSnapshot | null> {
  try {
    const response = await fetch(`${RESEARCH_BASE}/${jobId}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as ResearchSnapshot;
  } catch {
    return null;
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  try {
    await fetch(`${RESEARCH_BASE}/${jobId}/cancel`, { method: "POST" });
  } catch {
    // Cancelar es cortesía: si no llega, el presupuesto de tiempo lo cortará.
  }
}
