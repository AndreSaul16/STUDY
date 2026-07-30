/**
 * Tipos de la configuración de IA — espejo de backend/app/schemas/ai_settings_schemas.py.
 *
 * DÓNDE VIVE LA API KEY (decisión de fondo, no un detalle):
 *
 * En `localStorage`, bajo `study-ai-settings`, y en ningún otro sitio. Viaja
 * al backend solo en la cabecera `X-AI-Api-Key`, que el backend usa y tira: no
 * la persiste, no la loguea y no la devuelve en ninguna respuesta.
 *
 * **NO** se guarda en el SQLite local, aunque sería el sitio "natural" para el
 * estado del usuario: esa base **se exporta e importa** desde Ajustes, así que
 * la key acabaría dentro de cualquier copia de seguridad que se comparta. Ese
 * es el argumento decisivo.
 */

/** Clave de localStorage. Un solo objeto para toda la configuración de IA. */
export const AI_SETTINGS_KEY = "study-ai-settings";

/** Versión del objeto guardado: permite migrar sin perder las keys. */
export const AI_SETTINGS_VERSION = 1;

export type ImageQuality = "low" | "medium" | "high";

/** Lo que se guarda por proveedor. La key es lo delicado. */
export interface AiProviderSettings {
  apiKey: string;
  model: string;
}

export interface AiSettings {
  version: number;
  provider: string;
  effort: string;
  /**
   * Por proveedor y no una key plana: cambiar de OpenAI a Google y volver no
   * puede obligar a repegar la key. Pegar una API key en un móvil es de las
   * peores tareas que existen.
   */
  byProvider: Record<string, AiProviderSettings>;
  imageModel: string;
  imageQuality: ImageQuality;
  researchProvider: "propio" | "openai" | "google";
}

export interface AiEffort {
  id: string;
  label: string;
}

export interface AiProvider {
  id: string;
  label: string;
  key_hint: string;
  key_url: string;
  default_model: string;
  efforts: AiEffort[];
  supports_images: boolean;
  supports_deep_research: boolean;
  image_models: string[];
}

export interface AiServerDefaults {
  provider: string;
  model: string;
  effort: string;
  /** Booleano, nunca la key: el backend no la devuelve jamás. */
  has_server_key: boolean;
}

export interface AiProvidersResponse {
  providers: AiProvider[];
  server: AiServerDefaults;
}

export interface AiModel {
  id: string;
  label: string;
  description: string;
  family: string;
  reasoning: boolean;
  context: number | null;
  recommended: boolean;
}

export interface AiModelsResponse {
  provider: string;
  purpose: string;
  models: AiModel[];
  source: "api" | "fallback";
  notice: string | null;
}

/** Valor especial del `<select>` de modelo: "escribir otro a mano". */
export const CUSTOM_MODEL_VALUE = "__custom__";

export const DEFAULT_AI_PROVIDER = "openai";
export const DEFAULT_AI_EFFORT = "medio";

/**
 * Catálogo de respaldo.
 *
 * Mismo criterio que `FALLBACK_CHAT_MODES`: si `GET /api/ai/providers` falla,
 * Ajustes se tiene que poder abrir igualmente. Debe seguir los ids de
 * backend/app/services/ai/chat_providers.py.
 */
export const FALLBACK_AI_PROVIDERS: AiProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    key_hint: "sk-…",
    key_url: "https://platform.openai.com/api-keys",
    default_model: "gpt-5.6-luna",
    efforts: [
      { id: "ninguno", label: "Sin razonar (rápido)" },
      { id: "bajo", label: "Bajo" },
      { id: "medio", label: "Medio" },
      { id: "alto", label: "Alto" },
      { id: "maximo", label: "Máximo" },
    ],
    supports_images: true,
    supports_deep_research: true,
    image_models: ["gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2"],
  },
  {
    id: "google",
    label: "Google Gemini",
    key_hint: "AIza…",
    key_url: "https://aistudio.google.com/apikey",
    default_model: "gemini-3.5-flash",
    efforts: [
      { id: "ninguno", label: "Sin razonar (rápido)" },
      { id: "bajo", label: "Bajo" },
      { id: "medio", label: "Medio" },
      { id: "alto", label: "Alto" },
      { id: "maximo", label: "Máximo" },
    ],
    supports_images: true,
    supports_deep_research: false,
    image_models: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
  },
];

export const FALLBACK_AI_SERVER: AiServerDefaults = {
  provider: "openai",
  model: "gpt-4o-mini",
  effort: "ninguno",
  has_server_key: false,
};

export function emptyAiSettings(): AiSettings {
  return {
    version: AI_SETTINGS_VERSION,
    provider: DEFAULT_AI_PROVIDER,
    effort: DEFAULT_AI_EFFORT,
    byProvider: {},
    imageModel: "",
    imageQuality: "medium",
    researchProvider: "propio",
  };
}

/** Etiqueta corta de un modelo para las cabeceras: "5.6-luna", "3.5-flash". */
export function shortModelLabel(model: string): string {
  if (!model) return "";
  return model.replace(/^(gpt|gemini|o\d)-/, "").replace(/-preview$/, "");
}

/** Etiqueta de un escalón de esfuerzo, con degradado seguro al propio id. */
export function effortLabel(provider: AiProvider | undefined, id: string): string {
  return provider?.efforts.find((e) => e.id === id)?.label ?? id;
}
