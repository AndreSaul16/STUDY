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
  /** Vídeo de jw.org, citado por su transcripción. */
  VIDEO: "video",
  /**
   * Material de FUERA de jw.org (un artículo científico).
   *
   * Tiene su propio tipo para que se vea distinto en la interfaz: un chip de
   * La Atalaya y uno de una revista científica no pesan lo mismo, y el usuario
   * tiene que poder distinguirlos de un vistazo sin abrirlos.
   */
  EXTERNAL: "external",
  /**
   * Fragmento de una publicación .jwpub del PROPIO dispositivo.
   *
   * Tipo aparte porque su procedencia es distinta a todo lo demás: no lo buscó
   * el agente en jw.org, lo aportó el usuario desde su biblioteca. Verlo como
   * un chip de búsqueda normal escondería que la respuesta se apoya en algo que
   * él mismo autorizó a enviar.
   */
  LOCAL: "local",
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
  /** Herramientas ejecutadas en el turno (búsquedas, documentos, vídeos). */
  toolCalls?: number;
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

/**
 * Con qué responde UNA conversación. Se guarda en su fila de `conversations`.
 *
 * Existe para que se pueda tener una conversación con GPT y otra con Gemini
 * abiertas a la vez: antes el proveedor, el modelo y el esfuerzo eran globales
 * (`aiSettingsStore`) y la última elección se llevaba por delante a todos los
 * chats.
 *
 * `null` en cualquiera de los tres significa «usa el ajuste global», y es el
 * valor de las conversaciones anteriores a esta función: sus filas no tienen
 * estas columnas y tienen que seguir abriéndose y respondiendo igual que
 * siempre.
 *
 * **La API key NO está aquí, y no puede estarlo.** Vive solo en
 * `localStorage` (ver types/aiSettings.ts): el SQLite local se exporta y se
 * comparte como copia de seguridad, así que una key por conversación acabaría
 * dentro de cualquier backup. Lo que se guarda es a qué proveedor pertenece la
 * conversación; la key de ese proveedor se busca en los ajustes al enviar.
 */
export interface ConversationAi {
  provider: string | null;
  model: string | null;
  effort: string | null;
}

export interface ChatMode {
  id: string;
  label: string;
  hint: string;
  examples: string[];
  /**
   * Modo de investigación profunda: el backend responde con un `event: job` y
   * el informe llega minutos después. Opcional porque un backend anterior no
   * manda el campo.
   */
  deep?: boolean;
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
    id: "investigacion",
    label: "Investigación profunda",
    hint: "Dime el tema y lo investigo a fondo (varios minutos)",
    examples: [
      "Todo lo que dice La Atalaya sobre el aguante",
      "Estudio completo de Isaías 58",
      "Investiga el trasfondo histórico de Ester",
    ],
    deep: true,
  },
];

export const DEFAULT_CHAT_MODE = "analisis";

/** Etiqueta corta de un modo por id, con degradado seguro. */
export function chatModeLabel(modes: ChatMode[], id: string): string {
  return modes.find((m) => m.id === id)?.label ?? id;
}
