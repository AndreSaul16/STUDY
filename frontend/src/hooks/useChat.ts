import { useCallback, useEffect, useRef } from "react";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";

import {
  buildRequestMessages,
  CHAT_STREAM_ENDPOINT,
} from "@/services/chatClient";
import { useChatStore } from "@/store/chatStore";
import type { ChatSource, ChatUiMessage, ToolActivity } from "@/types/chat";

export type { ToolActivity } from "@/types/chat";

interface UseChatReturn {
  messages: ChatUiMessage[];
  isStreaming: boolean;
  streamingContent: string;
  /** Herramientas consultadas en el turno actual, en orden. */
  activity: ToolActivity[];
  error: string | null;
  send: (content: string) => void;
  cancel: () => void;
  /** Empieza una conversación nueva. Sustituye al antiguo "Limpiar". */
  newConversation: () => void;
  retryLast: () => void;
}

/**
 * Nombre técnico de la herramienta → qué contarle al usuario.
 *
 * Antes de responder, el modelo puede encadenar varias rondas de búsqueda y
 * tardar medio minuto largo. Sin esto el panel se queda en blanco todo ese
 * rato y parece que la app se ha colgado.
 */
export const TOOL_LABELS: Record<string, string> = {
  leer_pasaje_biblico: "Leyendo el pasaje bíblico",
  buscar_en_biblioteca: "Buscando en la Biblioteca en Línea",
  abrir_documento: "Leyendo el artículo",
  obtener_texto_del_dia: "Consultando el texto del día",
  get_verse_with_study: "Consultando notas de estudio",
  getWatchtowerContent: "Leyendo La Atalaya",
  getWatchtowerLinks: "Buscando en La Atalaya",
  getWorkbookContent: "Consultando la guía de actividades",
  getWorkbookLinks: "Buscando en la guía de actividades",
  get_jw_captions: "Revisando subtítulos de vídeo",
  get_bible_verse: "Leyendo el versículo",
  search_bible_books: "Buscando el libro bíblico",
};

/** Extrae el argumento más informativo para acompañar a la etiqueta. */
function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  if (typeof a.consulta === "string") return a.consulta;
  if (typeof a.query === "string") return a.query;
  if (typeof a.libro === "string") {
    return [a.libro, a.capitulo, a.versiculo && a.versiculo !== "all" ? `:${a.versiculo}` : ""]
      .filter(Boolean)
      .join(" ")
      .replace(" :", ":");
  }
  return "";
}

/** Valida las fuentes que llegan por SSE antes de meterlas en el store. */
function parseSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const s = item as Record<string, unknown>;
    if (typeof s.kind !== "string" || typeof s.label !== "string") return [];
    return [s as unknown as ChatSource];
  });
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/**
 * useChat — hook para el chat IA con OpenAI + MCP.
 *
 * Usa fetch + ReadableStream para consumir SSE del backend. El estado vive en
 * `chatStore` y el historial se persiste en SQLite: antes estaba en un
 * `useState` local y se perdía al recargar o al desmontar la pestaña.
 */
export function useChat(): UseChatReturn {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const activity = useChatStore((s) => s.activity);
  const error = useChatStore((s) => s.error);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Abortar el stream y bloquear setState al desmontar.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Abre el stream con el historial que ya hay en el store.
   *
   * Está separado de `send` para que reintentar tras un fallo de red no vuelva
   * a insertar el mensaje del usuario (ya está guardado en SQLite).
   */
  const runTurn = useCallback(async (conversationId: string) => {
    const requestMessages = buildRequestMessages(useChatStore.getState().messages);
    const mode = useChatStore.getState().mode;

    const controller = new AbortController();
    abortRef.current = controller;

    let fullContent = "";
    let suggestions: string[] = [];

    try {
      const response = await fetch(CHAT_STREAM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          messages: requestMessages,
          mode,
          conversation_id: conversationId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSSEEvents(buffer);
        buffer = rest;

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          const parsed = parseSSEEvent(rawEvent);
          // Los comentarios de keepalive (": ping") no parsean: se ignoran.
          if (!parsed) continue;

          const chat = useChatStore.getState();

          switch (parsed.event) {
            case "tool_call": {
              const name = String(parsed.data.name ?? "");
              if (!mountedRef.current || !name) break;
              chat.pushActivity({
                name,
                detail: describeArgs(parsed.data.arguments),
              });
              break;
            }
            case "tool_result": {
              const name = String(parsed.data.name ?? "");
              if (!mountedRef.current || !name) break;
              chat.completeActivity(name, String(parsed.data.summary ?? ""));
              break;
            }
            case "sources":
              if (mountedRef.current) {
                chat.setPendingSources(parseSources(parsed.data.items));
              }
              break;
            case "suggestions":
              suggestions = parseStringList(parsed.data.items);
              break;
            case "metadata":
              // Reservado para telemetría (model, mode, tool_calls). No hay
              // nada que pintar todavía; se ignora sin romper.
              break;
            case "token":
              fullContent += String(parsed.data.text ?? "");
              if (mountedRef.current) chat.appendToken(fullContent);
              break;
            case "error":
              if (mountedRef.current) {
                chat.setError(String(parsed.data.message ?? "Unknown error"));
              }
              break;
            case "done":
              // Stream completado
              break;
            default:
              // Evento desconocido de un backend más nuevo: se ignora.
              break;
          }
        }
      }

      if (mountedRef.current) {
        useChatStore.getState().finishTurn(fullContent, suggestions);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Cancelado por el usuario — el parcial se guarda igualmente.
        if (mountedRef.current) {
          useChatStore.getState().abortTurn(fullContent);
        }
      } else if (mountedRef.current) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const chat = useChatStore.getState();
        chat.setError(message);
        chat.abortTurn(fullContent);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      const store = useChatStore.getState();
      if (!trimmed || store.isStreaming) return;

      // El turno del usuario se persiste ANTES de abrir el stream: si la red
      // falla, la pregunta no se pierde y se puede reintentar.
      const conversationId = store.startTurn(trimmed);
      if (!conversationId) return;
      await runTurn(conversationId);
    },
    [runTurn],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newConversation = useCallback(() => {
    useChatStore.getState().newConversation();
  }, []);

  /**
   * Reintenta.
   *
   * Dos situaciones distintas con el mismo botón:
   *  - la última fue del usuario (falló la red): se reabre el stream SIN
   *    volver a insertar la pregunta, que ya está guardada;
   *  - la última fue del asistente ("volver a preguntar"): se manda otra vez
   *    la misma pregunta como turno nuevo, para no perder la respuesta previa.
   */
  const retryLast = useCallback(() => {
    const store = useChatStore.getState();
    if (store.isStreaming || !store.conversationId) return;

    const last = store.messages[store.messages.length - 1];
    if (!last) return;

    if (last.role === "user") {
      store.resumeTurn();
      void runTurn(store.conversationId);
      return;
    }

    const lastUser = [...store.messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content);
  }, [runTurn, send]);

  return {
    messages,
    isStreaming,
    streamingContent,
    activity,
    error,
    send,
    cancel,
    newConversation,
    retryLast,
  };
}
