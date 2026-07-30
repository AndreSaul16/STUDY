/**
 * Chat Types — espejo del contrato del backend.
 *
 * Backend define (services/ai/source_tracker.py, chat_modes.py):
 *   Source   { kind, label, citation?, url?, doc_id?, identifier? }
 *   ModeSpec → DTO { id, label, hint, examples[] }
 *
 * Los nombres de campo de `ChatSource` van en snake_case a propósito: llegan
 * así por SSE y renombrarlos en cada evento solo añadiría ruido.
 */

/** Clase de fuente — decide el icono del chip y cómo se abre al pulsarla. */
export const CHAT_SOURCE_KINDS = {
  SCRIPTURE: "scripture",
  ARTICLE: "article",
  SEARCH: "search",
  DAILY: "daily",
  MCP: "mcp",
} as const;

export type ChatSourceKind =
  (typeof CHAT_SOURCE_KINDS)[keyof typeof CHAT_SOURCE_KINDS];

export interface ChatSource {
  kind: ChatSourceKind;
  label: string;
  citation?: string;
  url?: string;
  /** Abre el artículo en el lector con openWolDocument(). */
  doc_id?: number;
  /** Identificador del ReferenceEngine, ej. "scripture:isaías:58:12". */
  identifier?: string;
}

/** Una consulta a fuentes dentro de un turno, para el rastro de actividad. */
export interface ToolActivity {
  name: string;
  detail: string;
  /** El backend ya devolvió el resultado de esta herramienta. */
  done?: boolean;
  /** Resumen del evento `tool_result`: "6 resultados", "Isaías 58". */
  summary?: string;
}

/**
 * Con qué se generó un mensaje. Llega en el evento `metadata` y se persiste
 * junto al mensaje: releyendo una conversación de hace un mes hay que poder
 * saber si la escribió el modelo bueno o el barato.
 *
 * Todo opcional a propósito: un backend anterior no manda estos campos.
 */
export interface ChatMessageMeta {
  provider?: string;
  model?: string;
  /** Esfuerzo pedido (id STUDY: "alto"). */
  effort?: string;
  /** Esfuerzo que el proveedor aplicó de verdad ("high"). Puede diferir. */
  effortApplied?: string;
  /** Informe de investigación profunda: cambia cómo se presenta el mensaje. */
  deep?: boolean;
  /** Publicaciones leídas en un informe profundo. */
  docs?: number;
}

export interface ChatUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: string;
  sources: ChatSource[];
  tools: ToolActivity[];
  suggestions: string[];
  meta?: ChatMessageMeta;
  createdAt: number;
}

export interface ChatMode {
  id: string;
  label: string;
  hint: string;
  examples: string[];
}

/**
 * Copia local del catálogo de modos.
 *
 * La app tiene que ser usable con el backend a medio arrancar o sin red: si
 * `GET /api/chat/modes` falla, el selector se pinta con esto. Debe seguir el
 * orden y los ids de backend/app/services/ai/chat_modes.py.
 */
export const FALLBACK_CHAT_MODES: ChatMode[] = [
  {
    id: "analisis",
    label: "Análisis con referencias",
    hint: "Pregunta lo que quieras y busco en las publicaciones",
    examples: [
      "¿Qué significa ser «reparadores de brechas»?",
      "¿Por qué Jeremías siguió predicando?",
      "Explícame el contexto de Filipenses 2",
    ],
  },
  {
    id: "comentario",
    label: "Comentario de 30 s",
    hint: "Pega el punto o el versículo y te lo redacto",
    examples: [
      "Comentario de Isaías 58:12",
      "Comentario sobre la paciencia de Jehová",
      "Comentario del párrafo 8 del estudio",
    ],
  },
  {
    id: "ilustracion",
    label: "Ilustración",
    hint: "Dime el punto y te busco una ilustración real",
    examples: [
      "Ilustración sobre la constancia en el ministerio",
      "Ilustración sobre el aguante en las pruebas",
      "Ilustración para Juan 13:34, 35",
    ],
  },
  {
    id: "discurso",
    label: "Discurso o parte",
    hint: "Dime el tema y la duración y te monto el guion",
    examples: [
      "Discurso de 5 minutos sobre estudiar bien",
      "Parte de 10 minutos sobre Esdras 7:10",
      "Guion para la lectura de Isaías 58",
    ],
  },
  {
    id: "presentacion",
    label: "Presentación y oración",
    hint: "Dime el acto y te escribo el guion completo",
    examples: [
      "Programa para una boda en el Salón del Reino",
      "Presentación de un discursante visitante",
      "Oración inicial para una reunión especial",
    ],
  },
];

export const DEFAULT_CHAT_MODE = "analisis";

/** Etiqueta corta de un modo por id, con degradado seguro. */
export function chatModeLabel(modes: ChatMode[], id: string): string {
  return modes.find((m) => m.id === id)?.label ?? id;
}
