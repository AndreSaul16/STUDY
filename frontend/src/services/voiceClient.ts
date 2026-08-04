/**
 * voiceClient — transcribir un ensayo y pedir la crítica.
 *
 * La key viaja en la cabecera `X-AI-Api-Key` (nunca en el cuerpo ni en la URL)
 * gracias a `voiceRequestHeaders()`, que es donde vive esa decisión. Se usa esa
 * y no `aiRequestHeaders()` porque el proveedor de voz puede no ser el del
 * chat: mandar la key de Gemini a OpenAI daría un 401 desconcertante.
 *
 * El audio va en `FormData`: meterlo en un JSON en base64 lo engordaría un
 * tercio y obligaría a tenerlo dos veces en la memoria del móvil.
 *
 * Igual que `imageClient`, este SÍ lanza. Un ensayo cuesta tiempo de grabar y
 * dinero de transcribir: un fallo silencioso con degradado a "no pasa nada"
 * dejaría al usuario mirando una pantalla que no cambia.
 */

import { API_BASE } from "@/services/apiBase";
import { voiceRequestHeaders } from "@/store/aiSettingsStore";
import {
  DEFAULT_PRACTICE_MODE,
  FALLBACK_PRACTICE_MODES,
  type PracticeMode,
  type PracticeResult,
  type TranscribeResult,
} from "@/types/voice";

const MODES_ENDPOINT = `${API_BASE}/api/voice/modes`;
const TRANSCRIBE_ENDPOINT = `${API_BASE}/api/voice/transcribe`;
const PRACTICE_ENDPOINT = `${API_BASE}/api/voice/practice`;

export interface PracticeRequest {
  audio: Blob;
  /** Extensión real del blob. La decide `useVoiceRecorder` por el mime. */
  filename: string;
  mode: string;
  /** Lo que midió el cronómetro del navegador. */
  durationMs: number;
  targetSeconds?: number;
  /** Qué quiere el usuario que le miren, en sus palabras. Opcional. */
  notes?: string;
  provider?: string;
  model?: string;
  sttModel?: string;
  effort?: string;
  /** ¿Que lea la crítica en voz alta? Cuesta dinero: por defecto no. */
  speak?: boolean;
  voice?: string;
}

/**
 * Catálogo de tipos de ensayo. Nunca lanza: cae a la copia local.
 *
 * Mismo criterio que `fetchProviders`: la pantalla se tiene que poder abrir con
 * el backend a medio arrancar, porque el usuario ya está de pie con el guion en
 * la mano.
 */
export async function fetchPracticeModes(): Promise<{
  modes: PracticeMode[];
  default: string;
}> {
  const fallback = {
    modes: FALLBACK_PRACTICE_MODES,
    default: DEFAULT_PRACTICE_MODE,
  };

  try {
    const response = await fetch(MODES_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallback;

    const raw = payload as Record<string, unknown>;
    const modes = Array.isArray(raw.modes) ? raw.modes.filter(isPracticeMode) : [];
    if (modes.length === 0) return fallback;

    return {
      modes,
      default: typeof raw.default === "string" ? raw.default : fallback.default,
    };
  } catch {
    return fallback;
  }
}

function isPracticeMode(value: unknown): value is PracticeMode {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.label === "string" &&
    typeof m.hint === "string" &&
    typeof m.target_seconds === "number"
  );
}

function buildForm(request: PracticeRequest): FormData {
  const form = new FormData();
  form.append("audio", request.audio, request.filename);
  form.append("mode", request.mode);
  form.append("duration_ms", String(Math.round(request.durationMs)));
  if (request.targetSeconds !== undefined) {
    form.append("target_seconds", String(request.targetSeconds));
  }
  if (request.notes?.trim()) form.append("notes", request.notes.trim());
  if (request.provider) form.append("provider", request.provider);
  if (request.model) form.append("model", request.model);
  if (request.sttModel) form.append("stt_model", request.sttModel);
  if (request.effort) form.append("effort", request.effort);
  if (request.speak) form.append("speak", "true");
  if (request.voice) form.append("voice", request.voice);
  return form;
}

/**
 * Envía el ensayo y devuelve transcripción + crítica.
 *
 * Sin `Content-Type` a mano: hay que dejar que el navegador ponga el suyo, que
 * incluye el `boundary` del multipart. Ponerlo nosotros rompe la subida con un
 * 400 que además parece un fallo del servidor.
 */
export async function sendPractice(
  request: PracticeRequest,
  signal?: AbortSignal,
): Promise<PracticeResult> {
  const response = await fetch(PRACTICE_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", ...voiceRequestHeaders() },
    body: buildForm(request),
    signal,
  });

  if (!response.ok) throw new Error(await readDetail(response));
  return (await response.json()) as PracticeResult;
}

/** Solo transcribir, sin crítica: más rápido y sin coste de chat. */
export async function sendTranscription(
  request: PracticeRequest,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("audio", request.audio, request.filename);
  form.append("duration_ms", String(Math.round(request.durationMs)));
  if (request.provider) form.append("provider", request.provider);
  if (request.sttModel) form.append("model", request.sttModel);

  const response = await fetch(TRANSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", ...voiceRequestHeaders() },
    body: form,
    signal,
  });

  if (!response.ok) throw new Error(await readDetail(response));
  return (await response.json()) as TranscribeResult;
}

/**
 * Mensaje de error legible.
 *
 * El backend ya devuelve `detail` en español y saneado (nunca hace eco del
 * cuerpo del proveedor), así que se usa tal cual. Lo que no se puede es
 * enseñar un "500 Internal Server Error" a alguien que acaba de grabar cinco
 * minutos de ensayo.
 */
async function readDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    const detail = (payload as Record<string, unknown> | null)?.detail;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    /* cuerpo no-JSON: se cae al mensaje por estado */
  }

  if (response.status === 413) return "La grabación es demasiado larga.";
  if (response.status === 428) {
    return "Configura tu API key en Más → Ajustes de IA para usar la voz.";
  }
  return "No se ha podido procesar la grabación.";
}

/** `data:` URI listo para un `<audio src>`. */
export function toAudioUri(mime: string, b64: string): string {
  return `data:${mime};base64,${b64}`;
}
