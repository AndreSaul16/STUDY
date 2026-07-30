import { useCallback, useEffect, useRef } from "react";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";

import {
  buildRequestMessages,
  CHAT_STREAM_ENDPOINT,
} from "@/services/chatClient";
import { followJob } from "@/services/researchClient";
import { aiRequestBody, aiRequestHeaders } from "@/store/aiSettingsStore";
import { useChatStore } from "@/store/chatStore";
import { useResearchStore } from "@/store/researchStore";
import type {
  ChatMessageMeta,
  ChatSource,
  ChatUiMessage,
  ToolActivity,
} from "@/types/chat";

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
 * Sigue una investigación profunda hasta el final.
 *
 * El turno de chat ya se cerró: el backend respondió con un `event: job` y
 * colgó. A partir de aquí el trabajo vive en el servidor y esta función se
 * limita a volcar sus eventos al store, reconectando sola si hace falta.
 *
 * Cuando llega el `done`, el informe se guarda como un mensaje normal del
 * asistente: así hereda copiar, compartir, exportar y los chips de fuentes sin
 * una sola línea de código nueva.
 */
export async function trackResearchJob(
  jobId: string,
  conversationId: string,
  question: string,
  estimatedSeconds: number,
  startFromEventId = 0,
): Promise<void> {
  const research = useResearchStore.getState();
  if (startFromEventId === 0) {
    research.start(jobId, conversationId, question, estimatedSeconds);
  }

  let answer = "";
  let meta: ChatMessageMeta | undefined;
  let sources: ChatSource[] = [];
  let docs = 0;

  await followJob({
    jobId,
    lastEventId: startFromEventId,
    onGone: () => {
      useResearchStore.getState().setError(
        "Esa investigación ya no está en el servidor. Puedes volver a lanzarla.",
      );
      useResearchStore.getState().finish();
      useChatStore.getState().abortTurn(answer);
    },
    onError: (message) => {
      useResearchStore.getState().setError(message);
    },
    onEvent: (event) => {
      const store = useResearchStore.getState();
      if (typeof event.id === "number") store.setLastEventId(event.id);

      switch (event.event) {
        case "plan": {
          const items = Array.isArray(event.data.items) ? event.data.items : [];
          store.setPlan(
            items.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const i = item as Record<string, unknown>;
              return typeof i.question === "string"
                ? [{ id: Number(i.id) || 0, question: i.question }]
                : [];
            }),
          );
          break;
        }
        case "progress":
          docs = Number(event.data.docs) || docs;
          store.setProgress({
            step: Number(event.data.step) || 0,
            total: Number(event.data.total) || 0,
            label: String(event.data.label ?? ""),
            docs,
            elapsedMs: Number(event.data.elapsed_ms) || 0,
          });
          break;
        case "sources":
          sources = parseSources(event.data.items);
          useChatStore.getState().setPendingSources(sources);
          break;
        case "token":
          answer += String(event.data.text ?? "");
          useChatStore.getState().appendToken(answer);
          break;
        case "metadata":
          meta = parseMeta(event.data);
          break;
        case "report":
          docs = Number(event.data.docs) || docs;
          meta = { ...(meta ?? {}), deep: true, docs };
          break;
        case "error":
          store.setError(String(event.data.message ?? "La investigación falló."));
          break;
        case "done":
          useChatStore
            .getState()
            .finishTurn(answer, [], { ...(meta ?? {}), deep: true, docs });
          store.finish();
          break;
        default:
          break;
      }
    },
  });
}

/** Metadatos del evento `metadata`. Todo opcional: el backend puede ser viejo. */
function parseMeta(raw: Record<string, unknown>): ChatMessageMeta | undefined {
  const text = (key: string): string | undefined =>
    typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : undefined;

  const meta: ChatMessageMeta = {
    provider: text("provider"),
    model: text("model"),
    effort: text("effort"),
    effortApplied: text("effort_applied"),
  };
  return Object.values(meta).some(Boolean) ? meta : undefined;
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
    let meta: ChatMessageMeta | undefined;
    let deepJob: { jobId: string; estimatedSeconds: number } | null = null;

    try {
      const response = await fetch(CHAT_STREAM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          // La API key del usuario, si la hay. Solo aquí: nunca en el cuerpo
          // ni en la URL. Sin key configurada esto es `{}` y la petición sale
          // exactamente igual que antes de que existiera el modo BYOK.
          ...aiRequestHeaders(),
        },
        body: JSON.stringify({
          messages: requestMessages,
          mode,
          conversation_id: conversationId,
          ...aiRequestBody(),
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
              // Qué modelo respondió de verdad y con cuánto esfuerzo. Se pinta
              // en el pie del mensaje y se persiste con él: sin esto, releyendo
              // una conversación de hace un mes no hay forma de saber si la
              // escribió el modelo bueno o el barato.
              meta = parseMeta(parsed.data);
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
            case "job": {
              // Modo profundo: el backend no responde con tokens sino con el
              // id de un trabajo que tarda minutos. El turno de chat se cierra
              // aquí y el seguimiento sigue por su cuenta.
              const jobId = String(parsed.data.job_id ?? "");
              if (!jobId) break;
              deepJob = {
                jobId,
                estimatedSeconds: Number(parsed.data.estimated_seconds) || 240,
              };
              break;
            }
            case "done":
              // Stream completado
              break;
            default:
              // Evento desconocido de un backend más nuevo: se ignora.
              break;
          }
        }
      }

      if (deepJob) {
        // El turno sigue "abierto" (isStreaming) a propósito: lo que llega
        // ahora es el informe, y el composer debe seguir bloqueado.
        const question =
          [...useChatStore.getState().messages]
            .reverse()
            .find((m) => m.role === "user")?.content ?? "";
        void trackResearchJob(
          deepJob.jobId,
          conversationId,
          question,
          deepJob.estimatedSeconds,
        );
        return;
      }

      if (mountedRef.current) {
        useChatStore.getState().finishTurn(fullContent, suggestions, meta);
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
