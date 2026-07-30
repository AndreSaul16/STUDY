/**
 * chatClient — cliente del chat IA.
 *
 * Aquí vive el ajuste del historial al contrato del backend. No es cosmético:
 * `ChatRequest` limita a 50 mensajes y `ChatMessage.content` a 8.000
 * caracteres. Mandar el historial entero sin recortar hacía que, en cuanto la
 * IA soltaba una respuesta larga, el SIGUIENTE turno recibiera un 422 y el
 * chat se rompiera en silencio.
 */

import { API_BASE } from "@/services/apiBase";
import {
  DEFAULT_CHAT_MODE,
  FALLBACK_CHAT_MODES,
  type ChatMode,
  type ChatUiMessage,
} from "@/types/chat";

export const CHAT_STREAM_ENDPOINT = `${API_BASE}/api/chat/stream`;
const CHAT_MODES_ENDPOINT = `${API_BASE}/api/chat/modes`;

/** Turnos que se reenvían. El backend admite 50; dejamos margen de sobra. */
export const MAX_HISTORY_MESSAGES = 16;

/** Tope por mensaje. El backend rechaza a partir de 8000. */
export const MAX_MESSAGE_CHARS = 7500;

const TRUNCATION_SUFFIX = " […]";

export interface ChatRequestMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatModesResponse {
  modes: ChatMode[];
  default: string;
}

/** Recorta por el final: el principio de la respuesta es lo que da contexto. */
function truncate(content: string): string {
  if (content.length <= MAX_MESSAGE_CHARS) return content;
  return content.slice(0, MAX_MESSAGE_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * Historial listo para el backend: recortado en número y en tamaño, y
 * empezando siempre por un turno del usuario (una conversación que arranca en
 * `assistant` desconcierta al modelo y no aporta nada).
 */
export function buildRequestMessages(
  messages: ChatUiMessage[],
): ChatRequestMessage[] {
  let window = messages.slice(-MAX_HISTORY_MESSAGES);

  while (window.length > 0 && window[0].role !== "user") {
    window = window.slice(1);
  }

  return window.map((m) => ({ role: m.role, content: truncate(m.content) }));
}

function isChatMode(value: unknown): value is ChatMode {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.label === "string" &&
    typeof m.hint === "string" &&
    Array.isArray(m.examples)
  );
}

/**
 * Catálogo de modos.
 *
 * Nunca lanza: si el backend está a medio arrancar o sin red, devuelve la
 * copia local. El selector de modos no puede quedarse vacío.
 */
export async function fetchChatModes(): Promise<ChatModesResponse> {
  const fallback: ChatModesResponse = {
    modes: FALLBACK_CHAT_MODES,
    default: DEFAULT_CHAT_MODE,
  };

  try {
    const response = await fetch(CHAT_MODES_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallback;

    const raw = payload as Record<string, unknown>;
    const modes = Array.isArray(raw.modes) ? raw.modes.filter(isChatMode) : [];
    if (modes.length === 0) return fallback;

    return {
      modes: modes.map((m) => ({ ...m, examples: m.examples.map(String) })),
      default: typeof raw.default === "string" ? raw.default : DEFAULT_CHAT_MODE,
    };
  } catch {
    return fallback;
  }
}
