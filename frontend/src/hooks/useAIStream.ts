import { useCallback, useRef, useEffect } from "react";
import { useAIStore } from "@/store/aiStore";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";
import type {
  AISkill,
  AIContextDTO,
  AIRequestDTO,
  AIResult,
  SSEMetadataEvent,
  SSETokenEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSEEventType,
} from "@/types/ai";
import { SSE_EVENT_TYPES, STREAM_STATES } from "@/types/ai";

/**
 * useAIStream — hook para consumir el endpoint SSE de IA.
 *
 * Usa fetch + ReadableStream (no EventSource) porque:
 *  1. EventSource solo soporta GET; nuestro endpoint es POST (envía contexto).
 *  2. ReadableStream permite cancelar el stream con AbortController.
 *  3. Mayor control sobre el parsing de eventos SSE.
 *
 * Flujo:
 *  1. execute(skill, context) → POST /api/ai/analyze con body AIRequestDTO
 *  2. Lee el stream chunk a chunk con reader.read()
 *  3. Parsea eventos SSE (event: type\ndata: json\n\n)
 *  4. Actualiza aiStore progresivamente (appendToken)
 *  5. Al recibir "done", guarda el resultado completo
 *  6. cancel() aborta la conexión via AbortController
 *
 * El hook NO bloquea el hilo principal: el parsing es async y cada token
 * se renderiza en un tick separado gracias al store de Zustand.
 */

const API_BASE = import.meta.env.VITE_AI_API_BASE ?? "http://localhost:8000";
const ANALYZE_ENDPOINT = `${API_BASE}/api/ai/analyze`;

interface UseAIStreamReturn {
  /** Estado actual del stream */
  streamState: ReturnType<typeof useAIStore.getState>["streamState"];
  /** Skill activa */
  activeSkill: AISkill | null;
  /** Contenido acumulado mientras streamea */
  streamingContent: string;
  /** Metadata del stream actual */
  metadata: SSEMetadataEvent | null;
  /** Error si falló */
  error: string | null;
  /** Resultados completados por skill */
  results: Partial<Record<AISkill, AIResult>>;

  /** Ejecuta una skill con un contexto dado (inicia el stream) */
  execute: (skill: AISkill, context: AIContextDTO) => Promise<void>;
  /** Cancela el stream en curso */
  cancel: () => void;
  /** ¿Está streamando ahora? */
  isStreaming: boolean;
  /** ¿Hay resultado cacheado para esta skill? */
  hasResult: (skill: AISkill) => boolean;
}

export function useAIStream(): UseAIStreamReturn {
  const abortRef = useRef<AbortController | null>(null);
  // Identifica el stream activo: si arranca uno nuevo, los callbacks del
  // anterior no deben tocar el store (evita clobber de resultados).
  const generationRef = useRef(0);

  const streamState = useAIStore((s) => s.streamState);
  const activeSkill = useAIStore((s) => s.activeSkill);
  const streamingContent = useAIStore((s) => s.streamingContent);
  const metadata = useAIStore((s) => s.metadata);
  const error = useAIStore((s) => s.error);
  const results = useAIStore((s) => s.results);

  const startStream = useAIStore((s) => s.startStream);
  const setMetadata = useAIStore((s) => s.setMetadata);
  const appendToken = useAIStore((s) => s.appendToken);
  const completeStream = useAIStore((s) => s.completeStream);
  const errorStream = useAIStore((s) => s.errorStream);
  const cancelStore = useAIStore((s) => s.cancelStream);
  const hasResultStore = useAIStore((s) => s.hasResult);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const execute = useCallback(
    async (skill: AISkill, context: AIContextDTO): Promise<void> => {
      // Cancelar stream anterior si existe
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      const myGeneration = ++generationRef.current;

      // Marcar inicio en el store
      startStream(skill);

      const requestBody: AIRequestDTO = {
        skill,
        context,
      };

      try {
        const response = await fetch(ANALYZE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Response body is null — streaming not supported");
        }

        // Leer el stream con ReadableStream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Capturar provider en closure al recibir metadata — no leer del store en onDone
        // porque el store podría haberse reseteado si el stream se canceló.
        let capturedProvider = "unknown";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          // Acumular al buffer y procesar eventos completos
          buffer += decoder.decode(value, { stream: true });

          // Los eventos SSE se separan por una línea en blanco
          const { events, rest } = splitSSEEvents(buffer);
          buffer = rest;

          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;
            handleSSEEvent(rawEvent, {
              onMetadata: (meta) => {
                capturedProvider = meta.provider ?? "unknown";
                setMetadata(meta);
              },
              onToken: appendToken,
              onDone: (doneEvent) => {
                const result: AIResult = {
                  skill,
                  content: useAIStore.getState().streamingContent,
                  provider: capturedProvider,
                  totalTokens: doneEvent.total_tokens,
                  elapsedMs: doneEvent.elapsed_ms,
                  completedAt: Date.now(),
                };
                completeStream(result);
              },
              onError: (err) => errorStream(err.message),
            });
          }
        }

        // Procesar cualquier evento restante en el buffer
        if (buffer.trim()) {
          handleSSEEvent(buffer, {
            onMetadata: (meta) => {
              capturedProvider = meta.provider ?? "unknown";
              setMetadata(meta);
            },
            onToken: appendToken,
            onDone: (doneEvent) => {
              const result: AIResult = {
                skill,
                content: useAIStore.getState().streamingContent,
                provider: capturedProvider,
                totalTokens: doneEvent.total_tokens,
                elapsedMs: doneEvent.elapsed_ms,
                completedAt: Date.now(),
              };
              completeStream(result);
            },
            onError: (err) => errorStream(err.message),
          });
        }
      } catch (err) {
        // Si ya arrancó otro stream, no tocar el store del stream nuevo.
        if (generationRef.current !== myGeneration) {
          return;
        }
        if (controller.signal.aborted) {
          cancelStore();
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          errorStream(message);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [startStream, setMetadata, appendToken, completeStream, errorStream, cancelStore],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    cancelStore();
  }, [cancelStore]);

  return {
    streamState,
    activeSkill,
    streamingContent,
    metadata,
    error,
    results,
    execute,
    cancel,
    isStreaming:
      streamState === STREAM_STATES.CONNECTING ||
      streamState === STREAM_STATES.STREAMING,
    hasResult: hasResultStore,
  };
}

// ─── Parser de eventos SSE ───────────────────────────────────────

interface SSEHandlers {
  onMetadata: (meta: SSEMetadataEvent) => void;
  onToken: (text: string) => void;
  onDone: (done: SSEDoneEvent) => void;
  onError: (err: SSEErrorEvent) => void;
}

/**
 * Parsea un evento SSE crudo y dispatcha al handler correspondiente.
 *
 * Formato SSE:
 *   event: metadata
 *   data: {"skill":"summary",...}
 *
 *   event: token
 *   data: {"text":"El ","index":0}
 */
function handleSSEEvent(raw: string, handlers: SSEHandlers): void {
  const parsed = parseSSEEvent(raw);
  if (!parsed) return;

  const { event: eventType, data } = parsed;

  switch (eventType as SSEEventType) {
    case SSE_EVENT_TYPES.METADATA:
      handlers.onMetadata(data as unknown as SSEMetadataEvent);
      break;
    case SSE_EVENT_TYPES.TOKEN: {
      const token = data as unknown as SSETokenEvent;
      handlers.onToken(token.text);
      break;
    }
    case SSE_EVENT_TYPES.DONE:
      handlers.onDone(data as unknown as SSEDoneEvent);
      break;
    case SSE_EVENT_TYPES.ERROR:
      handlers.onError(data as unknown as SSEErrorEvent);
      break;
    case SSE_EVENT_TYPES.CANCELLED:
      // El servidor confirmó cancelación — no action necesaria
      break;
  }
}

// ─── Helper: construir AIContextDTO desde el estado de la app ────

/**
 * Construye un AIContextDTO a partir del artículo actual y el bloque foco.
 * Útil para no repetir lógica de ensamblaje en los componentes.
 */
export function buildAIContext(params: {
  article: {
    documentId: number;
    title: string;
    blocks: { blockId: number; blockType: string; content: string }[];
  };
  focusBlockId: number;
  /** Número de bloques de contexto adyacente (anterior y siguiente) */
  windowSize?: number;
  activeReferences?: {
    identifier: string;
    label: string;
    type: string;
    resolvedContent: string | null;
  }[];
}): AIContextDTO {
  const { article, focusBlockId, windowSize = 2, activeReferences = [] } = params;
  const blocks = article.blocks;
  const focusIdx = blocks.findIndex((b) => b.blockId === focusBlockId);

  if (focusIdx === -1) {
    throw new Error(`Block ${focusBlockId} not found in article`);
  }

  const focus = blocks[focusIdx]!;
  const preceding = blocks.slice(Math.max(0, focusIdx - windowSize), focusIdx);
  const following = blocks.slice(focusIdx + 1, focusIdx + 1 + windowSize);

  // Buscar título del capítulo más cercano hacia atrás
  let chapterTitle: string | null = null;
  for (let i = focusIdx; i >= 0; i--) {
    if (blocks[i]!.blockType === "chapter") {
      chapterTitle = blocks[i]!.content;
      break;
    }
  }

  return {
    current_block: {
      block_id: focus.blockId,
      block_type: focus.blockType,
      content: focus.content,
    },
    preceding_blocks: preceding.map((b) => ({
      block_id: b.blockId,
      block_type: b.blockType,
      content: b.content,
    })),
    following_blocks: following.map((b) => ({
      block_id: b.blockId,
      block_type: b.blockType,
      content: b.content,
    })),
    chapter_title: chapterTitle,
    publication_title: article.title,
    document_id: article.documentId,
    active_references: activeReferences.map((r) => ({
      identifier: r.identifier,
      label: r.label,
      type: r.type,
      resolved_content: r.resolvedContent,
    })),
    language: "es",
  };
}
