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

      attempts = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

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
          onEvent(parsed);
          if (parsed.event === "done") finished = true;
        }
      }

      if (finished || signal?.aborted) return;
      // El servidor cerró sin `done`: se reconecta desde donde estábamos.
    } catch (error) {
      if (signal?.aborted) return;
      attempts += 1;
      if (attempts > MAX_RECONNECTS) {
        onError(
          error instanceof Error
            ? `Se perdió la conexión con la investigación (${error.message}).`
            : "Se perdió la conexión con la investigación.",
        );
        return;
      }
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
