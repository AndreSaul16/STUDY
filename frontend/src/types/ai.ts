/**
 * AI Types — espejo del backend app/schemas/ai_schemas.py.
 *
 * Estos tipos DEBEN mantenerse sincronizados con el backend.
 * Cualquier cambio en ai_schemas.py debe reflejarse aquí.
 */

// ─── Skills (tareas ejecutables) ─────────────────────────────────

export const AI_SKILLS = {
  SUMMARY: "summary",
  EXPLAIN_SIMPLE: "explain_simple",
  KEY_IDEAS: "key_ideas",
  MEDITATION_QUESTIONS: "meditation_questions",
  CONNECTIONS: "connections",
  MIND_MAP: "mind_map",
  KEYWORDS: "keywords",
} as const;

export type AISkill = (typeof AI_SKILLS)[keyof typeof AI_SKILLS];

// ─── Contexto de entrada (DTOs) ──────────────────────────────────

export interface BlockContextDTO {
  block_id: number;
  block_type: string;
  content: string;
}

export interface ReferenceContextDTO {
  identifier: string;
  label: string;
  type: string;
  resolved_content: string | null;
}

export interface AIContextDTO {
  current_block: BlockContextDTO;
  preceding_blocks: BlockContextDTO[];
  following_blocks: BlockContextDTO[];
  chapter_title: string | null;
  publication_title: string;
  document_id: number;
  active_references: ReferenceContextDTO[];
  language: string;
}

export interface AIRequestDTO {
  skill: AISkill;
  context: AIContextDTO;
  temperature?: number;
  max_tokens?: number;
}

// ─── Eventos SSE ─────────────────────────────────────────────────

export const SSE_EVENT_TYPES = {
  METADATA: "metadata",
  TOKEN: "token",
  DONE: "done",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

export type SSEEventType = (typeof SSE_EVENT_TYPES)[keyof typeof SSE_EVENT_TYPES];

export interface SSEMetadataEvent {
  skill: AISkill;
  provider: string;
  timestamp: number;
  estimated_tokens?: number;
}

export interface SSETokenEvent {
  text: string;
  index: number;
}

export interface SSEDoneEvent {
  total_tokens: number;
  finish_reason: "stop" | "length" | "cancelled";
  elapsed_ms: number;
}

export interface SSEErrorEvent {
  message: string;
  code: string;
}

// ─── Estado del stream en el frontend ────────────────────────────

export const STREAM_STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  STREAMING: "streaming",
  DONE: "done",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

export type StreamState = (typeof STREAM_STATES)[keyof typeof STREAM_STATES];

// ─── Resultado acumulado ─────────────────────────────────────────

export interface AIResult {
  skill: AISkill;
  content: string;
  provider: string;
  totalTokens: number;
  elapsedMs: number;
  /** Timestamp de finalización */
  completedAt: number;
}

// ─── Metadata de skills (para UI) ────────────────────────────────

export interface SkillMeta {
  id: AISkill;
  label: string;
  description: string;
  icon: string; // nombre del icono en atoms/Icons
}

export const SKILLS_METADATA: SkillMeta[] = [
  {
    id: AI_SKILLS.SUMMARY,
    label: "Resumen",
    description: "Síntesis estructurada del pasaje",
    icon: "IconBook",
  },
  {
    id: AI_SKILLS.EXPLAIN_SIMPLE,
    label: "Explicación sencilla",
    description: "Como si tuviera 10 años",
    icon: "IconNote",
  },
  {
    id: AI_SKILLS.KEY_IDEAS,
    label: "Ideas principales",
    description: "Conceptos nucleares en bullets",
    icon: "IconBookmark",
  },
  {
    id: AI_SKILLS.MEDITATION_QUESTIONS,
    label: "Preguntas para meditar",
    description: "Reflexión personal profunda",
    icon: "IconSearch",
  },
  {
    id: AI_SKILLS.CONNECTIONS,
    label: "Conexiones",
    description: "Intertextualidad bíblica",
    icon: "IconLink",
  },
  {
    id: AI_SKILLS.MIND_MAP,
    label: "Mapa mental",
    description: "Estructura visual en JSON",
    icon: "IconGlossary",
  },
  {
    id: AI_SKILLS.KEYWORDS,
    label: "Palabras clave",
    description: "Términos y origen lingüístico",
    icon: "IconHighlight",
  },
];
