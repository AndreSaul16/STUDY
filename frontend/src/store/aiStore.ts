import { create } from "zustand";
import type {
  AISkill,
  StreamState,
  AIResult,
  SSEMetadataEvent,
} from "@/types/ai";
import { STREAM_STATES } from "@/types/ai";

interface AIState {
  // ─── Estado del stream actual ───
  streamState: StreamState;
  /** Skill activa (la que se está ejecutando o la última) */
  activeSkill: AISkill | null;
  /** Contenido acumulado del stream (tokens concatenados) */
  streamingContent: string;
  /** Metadata del stream actual */
  metadata: SSEMetadataEvent | null;
  /** Error si streamState === ERROR */
  error: string | null;

  // ─── Historial de resultados ───
  /** Resultados completados, indexados por skill */
  results: Partial<Record<AISkill, AIResult>>;

  // ─── Acciones ───
  startStream: (skill: AISkill) => void;
  setMetadata: (meta: SSEMetadataEvent) => void;
  appendToken: (text: string) => void;
  completeStream: (result: AIResult) => void;
  errorStream: (message: string) => void;
  cancelStream: () => void;
  reset: () => void;
  /** ¿Hay un resultado cacheado para esta skill? */
  hasResult: (skill: AISkill) => boolean;
}

export const useAIStore = create<AIState>((set, get) => ({
  streamState: STREAM_STATES.IDLE,
  activeSkill: null,
  streamingContent: "",
  metadata: null,
  error: null,
  results: {},

  startStream: (skill) =>
    set({
      streamState: STREAM_STATES.CONNECTING,
      activeSkill: skill,
      streamingContent: "",
      metadata: null,
      error: null,
    }),

  setMetadata: (meta) =>
    set({
      metadata: meta,
      streamState: STREAM_STATES.STREAMING,
    }),

  appendToken: (text) =>
    set((s) => ({
      streamingContent: s.streamingContent + text,
      streamState: STREAM_STATES.STREAMING,
    })),

  completeStream: (result) =>
    set((s) => ({
      streamState: STREAM_STATES.DONE,
      streamingContent: "",
      error: null,
      results: { ...s.results, [result.skill]: result },
    })),

  errorStream: (message) =>
    set({
      streamState: STREAM_STATES.ERROR,
      error: message,
    }),

  cancelStream: () =>
    set({
      streamState: STREAM_STATES.CANCELLED,
      streamingContent: "",
    }),

  reset: () =>
    set({
      streamState: STREAM_STATES.IDLE,
      activeSkill: null,
      streamingContent: "",
      metadata: null,
      error: null,
    }),

  hasResult: (skill) => get().results[skill] !== undefined,
}));
