/**
 * Domain Types — alineados con backend/app/schemas/domain_schemas.py
 *
 * Backend define:
 *   PublicationBlock { blockId: int, blockType: str, content: str }
 *   Article { documentId: int, title: str, blocks: List[PublicationBlock] }
 *
 * El adapter del backend normaliza blockType a: paragraph | chapter | title | reference | image
 */

// ─── Mirror exacto del backend ───────────────────────────────────
export const BLOCK_TYPES = {
  PARAGRAPH: "paragraph",
  CHAPTER: "chapter",
  TITLE: "title",
  REFERENCE: "reference",
  IMAGE: "image",
  // Tipos que emiten las fuentes de wol.jw.org y el lector bíblico. Se
  // renderizan distinto (pregunta de estudio, subtítulo, versículo…) para que
  // un artículo de La Atalaya se lea como en la publicación y no como un
  // muro de párrafos iguales.
  HEADING: "heading",
  QUESTION: "question",
  SCRIPTURE: "scripture",
  CAPTION: "caption",
  VERSE: "verse",
} as const;

export type BlockType = (typeof BLOCK_TYPES)[keyof typeof BLOCK_TYPES];

export interface PublicationBlock {
  blockId: number;
  blockType: BlockType;
  content: string;
}

export interface Article {
  documentId: number;
  /** Símbolo de la publicación; documentId no es global entre JWPUB. */
  publicationSymbol?: string;
  title: string;
  blocks: PublicationBlock[];
}

// ─── Extensiones del dominio frontend ────────────────────────────

/** Color de subrayado — swatch del marcador */
export const HIGHLIGHT_COLORS = {
  YELLOW: "yellow",
  GREEN: "green",
  BLUE: "blue",
  PINK: "pink",
  ORANGE: "orange",
} as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[keyof typeof HIGHLIGHT_COLORS];

/** Anotación sobre un rango de texto dentro de un bloque */
export interface Annotation {
  id: string;
  blockId: number;
  /** Offset de inicio dentro del content del bloque */
  startOffset: number;
  /** Offset de fin (exclusivo) */
  endOffset: number;
  /** Texto seleccionado literal — para validación y búsqueda */
  selectedText: string;
  color: HighlightColor;
  /** Nota opcional adjunta */
  note: string | null;
  createdAt: number;
}

/** Referencia cruzada — un bloque de tipo "reference" apunta a esto */
export interface CrossReference {
  id: string;
  /** Etiqueta visible, ej: "Salmo 23:1" */
  label: string;
  /** Tipo de referencia para iconografía */
  kind: ReferenceKind;
  /** Bloque de origen que la menciona */
  sourceBlockId: number;
  /** Contenido expandido al pulsar */
  expandedContent: ReferenceContent;
}

export const REFERENCE_KINDS = {
  SCRIPTURE: "scripture",
  FOOTNOTE: "footnote",
  LINK: "link",
  GLOSSARY: "glossary",
} as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[keyof typeof REFERENCE_KINDS];

export interface ReferenceContent {
  title: string;
  body: string;
  /** Referencias anidadas opcionales */
  related?: CrossReference[];
}

/** Entrada del historial de navegación de referencias */
export interface HistoryEntry {
  referenceId: string;
  visitedAt: number;
}

/** Favorito — referencia marcada */
export interface FavoriteEntry {
  referenceId: string;
  label: string;
  addedAt: number;
}

// ─── UI State ────────────────────────────────────────────────────
export const RESEARCH_TABS = {
  BIBLE: "bible",
  SEARCH: "search",
  LIBRARY: "library",
  /**
   * El lector, dentro del propio panel.
   *
   * Existe para que abrir un libro NO te eche del chat: antes, poner un
   * artículo en `readerStore` cambiaba la vista entera a "leer" y la
   * conversación desaparecía. Con esta pestaña se lee al lado de lo que se
   * está preguntando, que es como se estudia de verdad.
   */
  READER: "reader",
  REFERENCE: "reference",
  ANNOTATIONS: "annotations",
  FAVORITES: "favorites",
  AI: "ai",
  CHAT: "chat",
  NOTES: "notes",
  INTEROP: "interop",
} as const;

export type ResearchTab = (typeof RESEARCH_TABS)[keyof typeof RESEARCH_TABS];

/**
 * Destinos de primer nivel de la app.
 *
 * Distinto de RESEARCH_TABS: aquello son las pestañas del panel de
 * investigación (que sigue igual); esto es dónde está el usuario. El chat es
 * el primero y el destino por defecto porque es el núcleo de la app, no una
 * pestaña novena de diez dentro de un bottom sheet.
 */
export const APP_VIEWS = {
  CHAT: "chat",
  /**
   * Practicar hablando: se graba un ensayo y la IA lo escucha y lo critica.
   *
   * Destino de primer nivel y no una pestaña del panel porque se usa DE PIE,
   * con el móvil en la mano y ensayando en voz alta. Enterrarlo a dos toques
   * dentro de "Más" sería pedirle a alguien que está de pie que navegue.
   */
  VOICE: "voice",
  READ: "read",
  BIBLE: "bible",
  MORE: "more",
} as const;

export type AppView = (typeof APP_VIEWS)[keyof typeof APP_VIEWS];

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

/** Estado de carga de una referencia */
export const LOAD_STATES = {
  IDLE: "idle",
  LOADING: "loading",
  LOADED: "loaded",
  ERROR: "error",
} as const;

export type LoadState = (typeof LOAD_STATES)[keyof typeof LOAD_STATES];

/** Coordenadas de pantalla para el menú contextual */
export interface ViewportPoint {
  x: number;
  y: number;
}

/** Rango de texto seleccionado con coordenadas */
export interface SelectionRange {
  blockId: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  /** Rect del bounding box para posicionar el menú */
  rect: DOMRect;
}
