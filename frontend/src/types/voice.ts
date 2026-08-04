/**
 * Tipos de la pestaña de voz — espejo de backend/app/schemas/voice_schemas.py.
 *
 * La API key NO aparece en ninguno de estos tipos, ni en la petición ni en la
 * respuesta: viaja solo en la cabecera `X-AI-Api-Key` que pone
 * `aiRequestHeaders()`. Si alguna vez aparece un campo `apiKey` aquí, está mal.
 */

/** Un tipo de ensayo. `target_seconds` 0 = sin duración objetivo. */
export interface PracticeMode {
  id: string;
  label: string;
  hint: string;
  target_seconds: number;
}

export interface VoiceTranscription {
  text: string;
  model: string;
  duration_seconds: number;
  /**
   * De dónde sale la duración:
   * - `audio`: la midió el proveedor sobre el fichero. Es un hecho.
   * - `grabadora`: el cronómetro del navegador. Puede incluir el silencio
   *   entre que se dejó de hablar y se pulsó parar.
   * - `desconocida`: no hay dato.
   */
  duration_source: "audio" | "grabadora" | "desconocida";
  language: string;
}

export interface TranscribeResult {
  provider: string;
  transcription: VoiceTranscription;
  elapsed_ms: number;
}

export interface PracticeResult {
  provider: string;
  mode: string;
  transcription: VoiceTranscription;
  feedback: string;
  model: string;
  target_seconds: number;
  /** mp3 en base64. `null` si no se pidió voz o si la síntesis falló. */
  audio_b64: string | null;
  audio_mime: string | null;
  voice: string | null;
  elapsed_ms: number;
}

/**
 * Catálogo de respaldo.
 *
 * Mismo criterio que `FALLBACK_AI_PROVIDERS`: si `GET /api/voice/modes` falla,
 * la pantalla se tiene que poder usar igual. Debe seguir los ids de
 * backend/app/services/ai/voice_service.py.
 */
export const FALLBACK_PRACTICE_MODES: PracticeMode[] = [
  {
    id: "discurso",
    label: "Discurso o parte",
    hint: "Ensaya la parte entera, con las pausas de verdad",
    target_seconds: 300,
  },
  {
    id: "predicacion",
    label: "Presentación de predicación",
    hint: "Di la presentación como se la dirías a la persona",
    target_seconds: 45,
  },
  {
    id: "lectura",
    label: "Lectura de la Biblia",
    hint: "Lee el pasaje en voz alta, sin correr",
    target_seconds: 240,
  },
  {
    id: "comentario",
    label: "Comentario de 30 s",
    hint: "Suelta el comentario como lo dirías en la reunión",
    target_seconds: 30,
  },
  {
    id: "libre",
    label: "Ensayo libre",
    hint: "Habla de lo que quieras practicar",
    target_seconds: 0,
  },
];

export const DEFAULT_PRACTICE_MODE = "discurso";

/**
 * Tope de la grabación en el navegador, en milisegundos.
 *
 * Espejo de `MAX_AUDIO_SECONDS` del backend. Se para sola al llegar: es la
 * única forma de que una grabación olvidada en el bolsillo no acabe en una
 * subida de veinte megas que el servidor rechaza cuando ya se ha esperado a
 * que suba entera.
 */
export const MAX_RECORDING_MS = 15 * 60 * 1000;

/** "4:12" — cronómetro. Los segundos van siempre con dos cifras. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}
