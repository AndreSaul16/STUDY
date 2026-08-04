/**
 * offlineClient — descarga de la Biblia a la caché del backend.
 *
 * Bajarse los 1.189 capítulos es una hora larga: el trabajo vive en el
 * servidor y el cliente se engancha y se desengancha, igual que la
 * investigación profunda. Se puede cerrar la pantalla, ir a leer y volver.
 *
 * `followDownload` reconecta sola tras un corte mandando `Last-Event-ID` con
 * el último evento visto, así que reanudar no cuesta ni un evento repetido ni
 * un capítulo repetido. Si el trabajo ya no existe (un redeploy lo mató) llama
 * a `onGone`; ahí no se pierde nada, porque lo ya descargado está en la caché
 * de disco y relanzar se lo salta.
 */

import { API_BASE } from "@/services/apiBase";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";
import type { ParsedSSEEvent } from "@/utils/sse";

const OFFLINE_BASE = `${API_BASE}/api/offline`;

/** Reintentos de reconexión antes de rendirse. */
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2000;

export interface OfflineStatus {
  /** Capítulos de toda la Biblia (1.189). */
  total: number;
  cached: number;
  missing: number;
  complete: boolean;
  bytes: number;
  cache_available: boolean;
  /** Descarga en marcha a la que reengancharse, si la hay. */
  job_id: string | null;
}

export interface StartedDownload {
  job_id: string;
  total: number;
  pending: number;
  estimated_seconds: number;
}

/** El payload de un `event: progress`. */
export interface DownloadProgress {
  done: number;
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  label: string;
  elapsed_ms: number;
}

/** Cuánto hay descargado. Una consulta agregada, sin red contra WOL. */
export async function fetchOfflineStatus(): Promise<OfflineStatus | null> {
  try {
    const response = await fetch(`${OFFLINE_BASE}/status`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as OfflineStatus;
  } catch {
    // Sin backend, la fila simplemente no se pinta. No es un error que
    // merezca interrumpir la pantalla de ajustes.
    return null;
  }
}

/**
 * Arranca la descarga. Con `books` se acota a unos libros concretos.
 *
 * Un 409 significa que ya hay una en marcha: el backend devuelve su id en la
 * cabecera para que la interfaz se enganche a esa en vez de fallar.
 */
export async function startBibleDownload(
  books?: number[],
): Promise<StartedDownload> {
  const response = await fetch(`${OFFLINE_BASE}/bible/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(books ? { books } : {}),
  });

  if (response.status === 409) {
    const enMarcha = response.headers.get("X-Offline-Job-Id");
    if (enMarcha) {
      const estado = await fetchOfflineStatus();
      return {
        job_id: enMarcha,
        total: estado?.total ?? 0,
        pending: estado?.missing ?? 0,
        estimated_seconds: 0,
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? "Ese conjunto de libros no es válido."
        : "No se pudo empezar la descarga.",
    );
  }

  return (await response.json()) as StartedDownload;
}

export interface FollowDownloadOptions {
  jobId: string;
  lastEventId?: number;
  signal?: AbortSignal;
  onEvent: (event: ParsedSSEEvent) => void;
  onGone: () => void;
  onError: (message: string) => void;
}

export async function followDownload({
  jobId,
  lastEventId = 0,
  signal,
  onEvent,
  onGone,
  onError,
}: FollowDownloadOptions): Promise<void> {
  let cursor = lastEventId;
  let attempts = 0;

  while (!signal?.aborted) {
    try {
      const response = await fetch(`${OFFLINE_BASE}/stream/${jobId}`, {
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
      // El contador se pone a cero cuando llega ALGO, no con el 200: una
      // conexión que abre y cierra en vacío lo dejaría siempre en 1 y el tope
      // de reintentos nunca se alcanzaría.
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

      // El servidor cerró sin `done`: cuenta como intento igual que un error de
      // red, o el cliente reconectaría en bucle cerrado contra un trabajo que
      // ya no va a emitir nada.
      attempts += 1;
      if (attempts > MAX_RECONNECTS) {
        onError("La descarga dejó de enviar datos.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    } catch (error) {
      if (signal?.aborted) return;
      attempts += 1;
      if (attempts > MAX_RECONNECTS) {
        onError(
          error instanceof Error
            ? `Se perdió la conexión con la descarga (${error.message}).`
            : "Se perdió la conexión con la descarga.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  }
}

export async function cancelDownload(jobId: string): Promise<void> {
  try {
    await fetch(`${OFFLINE_BASE}/${jobId}/cancel`, { method: "POST" });
  } catch {
    // Cancelar es cortesía: si no llega, la descarga terminará por su cuenta.
  }
}
