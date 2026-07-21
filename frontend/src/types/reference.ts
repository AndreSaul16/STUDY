/**
 * Reference Engine Types — Modelo estricto para el motor de referencias.
 *
 * Una `Reference` es la abstracción normalizada de cualquier cita detectable
 * en el texto de estudio: textos bíblicos, publicaciones, notas del autor
 * o referencias cruzadas genéricas.
 *
 * El motor detecta referencias en texto plano, las normaliza a este modelo
 * y las resuelve (con caché) a un `ResolvedReference` con contenido expandido.
 */

// ─── Tipo de referencia (enum) ───────────────────────────────────

export const REFERENCE_TYPES = {
  /** Texto bíblico — ej: "Salmo 23:1", "Juan 3:16", "1 Corintios 13:4-7" */
  SCRIPTURE: "scripture",
  /** Publicación — ej: "La Atalaya 2023", "¡Despertad! julio 2022" */
  PUBLICATION: "publication",
  /** Nota del autor — ej: "[1]", "nota 3", "nota al pie 2" */
  FOOTNOTE: "footnote",
  /** Referencia cruzada genérica — ej: "cf. Salmo 23", "véase también Juan 3" */
  CROSS_REFERENCE: "cross_reference",
} as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[keyof typeof REFERENCE_TYPES];

// ─── Modelo principal: Reference ─────────────────────────────────

/**
 * Representación normalizada de una referencia detectada en el texto.
 *
 * Todos los campos excepto `type` e `identifier` son opcionales (null)
 * porque no todos los tipos de referencia tienen los mismos componentes:
 *  - Scripture: publication = libro, chapter = capítulo, paragraph = versículo
 *  - Publication: publication = nombre, chapter = edición, paragraph = página
 *  - Footnote: chapter/paragraph = número de nota
 *  - CrossRef: publication = destino, el resto null
 */
export interface Reference {
  /** Tipo categorizado — determina qué resolver la procesa */
  type: ReferenceType;
  /** Nombre de la publicación o libro (ej: "Salmo", "La Atalaya"). null si no aplica */
  publication: string | null;
  /** Capítulo o edición. null si no aplica */
  chapter: number | null;
  /** Párrafo, versículo o página. null si no aplica */
  paragraph: number | null;
  /** Identificador único y estable — usado como key de caché */
  identifier: string;
}

// ─── Referencia detectada en texto (con posición) ────────────────

/**
 * Salida del parser: una referencia detectada con su posición en el texto.
 * El renderer usa start/end para envolver el texto en un chip clicable.
 */
export interface DetectedReference {
  /** La referencia normalizada */
  reference: Reference;
  /** Offset de inicio en el texto fuente (inclusivo) */
  start: number;
  /** Offset de fin en el texto fuente (exclusivo) */
  end: number;
  /** Texto literal que coincidió — para display y debug */
  raw: string;
}

// ─── Referencia resuelta (con contenido expandido) ───────────────

/**
 * Resultado de resolver una referencia — lo que muestra el panel derecho.
 * Este es el tipo que se cachea.
 */
export interface ResolvedReference {
  /** La referencia original que se resolvió */
  reference: Reference;
  /** Título legible para el header del panel */
  title: string;
  /** Cuerpo del contenido expandido */
  body: string;
  /** Subtítulo o contexto adicional (opcional) */
  subtitle?: string;
  /** Referencias relacionadas detectables (para navegación profunda) */
  related?: Reference[];
  /** Timestamp de resolución — para estadísticas de caché */
  resolvedAt: number;
  /** Fuente de la resolución — para transparencia */
  source: ResolutionSource;
}

export const RESOLUTION_SOURCES = {
  CACHE: "cache",
  MOCK: "mock",
  API: "api",
} as const;

export type ResolutionSource = (typeof RESOLUTION_SOURCES)[keyof typeof RESOLUTION_SOURCES];

// ─── Interfaces de Strategy (Parser y Resolver) ──────────────────

/**
 * Strategy: un parser detecta referencias de un tipo concreto en texto.
 * Cada implementación define sus propias regex y lógica de normalización.
 */
export interface ReferenceParser {
  /** Tipo de referencia que este parser detecta */
  readonly type: ReferenceType;
  /** Detecta todas las ocurrencias en el texto dado */
  parse(text: string): DetectedReference[];
}

/**
 * Strategy: un resolver obtiene el contenido expandido de una referencia.
 * Por ahora devuelve mock; la tubería queda lista para conectar a FastAPI.
 */
export interface ReferenceResolver {
  /** Tipo de referencia que este resolver maneja */
  readonly type: ReferenceType;
  /** Resuelve una referencia — debe ser idempotente y cacheable */
  resolve(ref: Reference): Promise<ResolvedReference>;
}

// ─── Estadísticas de caché ───────────────────────────────────────

export interface CacheStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  /** Ratio de aciertos 0..1 */
  hitRate: number;
}

// ─── Opciones del motor ──────────────────────────────────────────

export interface ReferenceEngineOptions {
  /** Capacidad máxima de la caché LRU (default: 128) */
  cacheCapacity?: number;
  /** Latencia simulada para resoluciones mock en ms (default: 600) */
  mockLatencyMs?: number;
  /** Parsers registrados — si se omite, usa los defaults */
  parsers?: ReferenceParser[];
  /** Resolvers registrados — si se omite, usa los defaults */
  resolvers?: ReferenceResolver[];
}
