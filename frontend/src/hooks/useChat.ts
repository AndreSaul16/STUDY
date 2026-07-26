import { useCallback, useEffect, useRef, useState } from "react";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";

import { API_BASE } from "@/services/apiBase";
const CHAT_ENDPOINT = `${API_BASE}/api/chat/stream`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Una consulta a fuentes en curso, para poder enseñarla mientras pasa. */
export interface ToolActivity {
  name: string;
  detail: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  /** Herramientas consultadas en el turno actual, en orden. */
  activity: ToolActivity[];
  error: string | null;
  send: (content: string) => void;
  cancel: () => void;
  clear: () => void;
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

/**
 * useChat — hook para el chat IA con OpenAI + MCP.
 *
 * Usa fetch + ReadableStream para consumir SSE del backend.
 * Mantiene historial de mensajes y estado de streaming.
 */
export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      setError(null);

      // Añadir mensaje del usuario
      const userMsg: ChatMessage = { role: "user", content };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      // Preparar stream
      setIsStreaming(true);
      setStreamingContent("");
      setActivity([]);

      const controller = new AbortController();
      abortRef.current = controller;

      let fullContent = "";

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
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
            if (!parsed) continue;

            switch (parsed.event) {
              case "tool_call": {
                const name = String(parsed.data.name ?? "");
                if (!mountedRef.current || !name) break;
                setActivity((prev) => [
                  ...prev,
                  {
                    name,
                    detail: describeArgs(parsed.data.arguments),
                  },
                ]);
                break;
              }
              case "token":
                fullContent += String(parsed.data.text ?? "");
                if (mountedRef.current) setStreamingContent(fullContent);
                break;
              case "error":
                if (mountedRef.current) {
                  setError(String(parsed.data.message ?? "Unknown error"));
                }
                break;
              case "done":
                // Stream completado
                break;
            }
          }
        }

        // Añadir respuesta del asistente al historial
        if (fullContent && mountedRef.current) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: fullContent },
          ]);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Cancelado por el usuario — guardar contenido parcial (local, no del store)
          if (fullContent && mountedRef.current) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: fullContent + " [cancelado]" },
            ]);
          }
        } else if (mountedRef.current) {
          const message = err instanceof Error ? err.message : "Unknown error";
          setError(message);
        }
      } finally {
        if (mountedRef.current) {
          setIsStreaming(false);
          setStreamingContent("");
          setActivity([]);
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [messages, isStreaming],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
    setActivity([]);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    streamingContent,
    activity,
    error,
    send,
    cancel,
    clear,
  };
}
