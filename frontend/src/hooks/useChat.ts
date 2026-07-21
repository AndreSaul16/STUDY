import { useCallback, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_AI_API_BASE ?? "http://localhost:8000";
const CHAT_ENDPOINT = `${API_BASE}/api/chat/stream`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  send: (content: string) => void;
  cancel: () => void;
  clear: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

      const controller = new AbortController();
      abortRef.current = controller;

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
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;
            const parsed = parseSSEEvent(rawEvent);
            if (!parsed) continue;

            switch (parsed.event) {
              case "token":
                fullContent += String(parsed.data.text ?? "");
                setStreamingContent(fullContent);
                break;
              case "error":
                setError(String(parsed.data.message ?? "Unknown error"));
                break;
              case "done":
                // Stream completado
                break;
            }
          }
        }

        // Añadir respuesta del asistente al historial
        if (fullContent) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: fullContent },
          ]);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Cancelado por el usuario — guardar contenido parcial
          if (streamingContent) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: streamingContent + " [cancelado]" },
            ]);
          }
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          setError(message);
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [messages, isStreaming, streamingContent],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    streamingContent,
    error,
    send,
    cancel,
    clear,
  };
}

// ─── Parser SSE ──────────────────────────────────────────────────

interface ParsedSSE {
  event: string;
  data: Record<string, unknown>;
}

function parseSSEEvent(raw: string): ParsedSSE | null {
  const lines = raw.split("\n");
  let eventType = "";
  let dataLine = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLine = line.slice(5).trim();
    }
  }

  if (!eventType || !dataLine) return null;

  try {
    return { event: eventType, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}
