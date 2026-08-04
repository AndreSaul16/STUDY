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

/**
 * Versión del objeto guardado: permite migrar sin perder las keys.
 *
 * 4 = se añade `localBooks`. Igual que en la 3 (ajustes de voz) no hace falta
 * migración: `readSettings` lee campo a campo y cada uno cae a su default por
 * separado, así que quien tuviera guardada una versión anterior conserva sus
 * keys y estrena el campo nuevo vacío — que además es el valor seguro, porque
 * significa "no mandes nada de mi biblioteca".
 */
export const AI_SETTINGS_VERSION = 4;

export type ImageQuality = "low" | "medium" | "high";

/**
 * Ajustes de investigación — espejo de `ResearchOptions` del backend.
 *
 * **Un solo interruptor.** El descarte de material apostata y los avisos de
 * antigüedad no están aquí a propósito: son raíles de seguridad, no
 * preferencias, y ofrecerlos como opción sugería que apagarlos era razonable.
 */
export interface ResearchSettings {
  /** ¿Puede salir a catálogos científicos en la investigación profunda? */
  internet: boolean;
  /** Suelo de antigüedad por defecto de las búsquedas. `null` = sin suelo. */
  minYear: number | null;
}

export function defaultResearchSettings(): ResearchSettings {
  return { internet: true, minYear: null };
}

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
  research: ResearchSettings;
  /**
   * Símbolos de las publicaciones .jwpub que el usuario autoriza a consultar
   * en el chat (ej. `["bt", "lff"]`).
   *
   * Se guardan los SÍMBOLOS y no las publicaciones: el contenido vive en
   * IndexedDB (libraryCache) y duplicarlo aquí metería megas de HTML en
   * `localStorage`, que además tiene un tope de 5 MB por origen.
   *
   * Vacío por defecto, y eso es una decisión de privacidad, no un descuido:
   * marcar un libro significa que sus fragmentos viajan al proveedor de IA en
   * cada pregunta que los use, así que tiene que ser un acto explícito.
   */
  localBooks: string[];
  /**
   * Proveedor de la pestaña de voz, aparte del de chat a propósito: hoy solo
   * OpenAI tiene voz verificada, así que quien use Gemini para el chat tiene
   * que poder seguir usándolo sin perder la pestaña de voz. Cadena vacía = el
   * primero que la soporte.
   */
  voiceProvider: string;
  /** Último tipo de ensayo usado. Se recuerda: casi siempre se repite. */
  voiceMode: string;
  /** Modelo de transcripción. Vacío = el que traiga el proveedor por defecto. */
  sttModel: string;
  /** Voz de la respuesta hablada. */
  ttsVoice: string;
  /** ¿Que lea la crítica en voz alta? Cuesta dinero: por defecto no. */
  speakBack: boolean;
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
  /**
   * Capacidades de voz. El backend solo las declara donde las ha PROBADO
   * contra la API de verdad (ver chat_providers.py), así que la interfaz puede
   * fiarse de esto para decidir qué ofrecer: un proveedor con `supports_stt`
   * en false no aparece en el selector de la pestaña de voz.
   */
  supports_stt: boolean;
  supports_tts: boolean;
  stt_models: string[];
  tts_models: string[];
  tts_voices: string[];
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
    // Verificado contra la API real: /v1/audio/transcriptions y
    // /v1/audio/speech responden 200. whisper-1 va primero porque es el único
    // que devuelve la duración del audio.
    supports_stt: true,
    supports_tts: true,
    stt_models: ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"],
    tts_models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    tts_voices: [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "onyx",
      "nova",
      "sage",
      "shimmer",
      "verse",
      "cedar",
      "marin",
    ],
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
    // Su capa compatible con OpenAI devuelve 404 en /audio/*: no se ofrece.
    supports_stt: false,
    supports_tts: false,
    stt_models: [],
    tts_models: [],
    tts_voices: [],
  },
  {
    id: "minimax",
    label: "MiniMax",
    key_hint: "sk-…",
    key_url:
      "https://platform.minimax.io/user-center/basic-information/interface-key",
    default_model: "MiniMax-M2.7",
    efforts: [
      { id: "ninguno", label: "Sin razonar (rápido)" },
      { id: "bajo", label: "Bajo" },
      { id: "medio", label: "Medio" },
      { id: "alto", label: "Alto" },
      { id: "maximo", label: "Máximo" },
    ],
    // Generación de imagen no verificada por la vía compatible con OpenAI: no
    // se ofrece hasta comprobarla.
    supports_images: false,
    supports_deep_research: false,
    image_models: [],
    // /v1/audio/* devuelve 404. Su TTS nativo (/v1/t2a_v2) existe pero es otro
    // contrato y no se ha podido probar: no se ofrece.
    supports_stt: false,
    supports_tts: false,
    stt_models: [],
    tts_models: [],
    tts_voices: [],
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
    research: defaultResearchSettings(),
    localBooks: [],
    voiceProvider: "",
    voiceMode: "",
    sttModel: "",
    ttsVoice: "",
    speakBack: false,
  };
}

/**
 * Los proveedores que de verdad pueden transcribir.
 *
 * La interfaz NUNCA ofrece un proveedor de voz sin comprobar: prometer uno que
 * contesta 404 es peor que no ofrecerlo. La lista sale del backend, que es
 * quien sabe qué se ha verificado.
 */
export function voiceCapableProviders(providers: AiProvider[]): AiProvider[] {
  return providers.filter((p) => p.supports_stt && p.stt_models.length > 0);
}

/** El proveedor de voz activo, o `undefined` si no hay ninguno verificado. */
export function resolveVoiceProvider(
  providers: AiProvider[],
  preferred: string,
): AiProvider | undefined {
  const capaces = voiceCapableProviders(providers);
  return capaces.find((p) => p.id === preferred) ?? capaces[0];
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
