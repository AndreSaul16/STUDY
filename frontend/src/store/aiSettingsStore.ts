/**
 * aiSettingsStore — proveedor, API key, modelo y esfuerzo.
 *
 * SIN el middleware `persist` a propósito: la lectura y la escritura de
 * `localStorage` van a mano, con `try/catch`, igual que `readStoredMode` en
 * `chatStore`. El modo privado de Safari lanza al escribir en `localStorage`, y
 * eso no puede dejar la app en blanco.
 *
 * La key vive AQUÍ y solo aquí (ver types/aiSettings.ts para el porqué de
 * localStorage y no del SQLite local). De este módulo salen los dos getters que
 * usan todos los clientes HTTP —`aiRequestHeaders` y `aiRequestBody`— para que
 * el reparto cabecera/cuerpo esté escrito UNA vez:
 *
 *   - la key SOLO en la cabecera `X-AI-Api-Key`;
 *   - `provider` / `model` / `effort` en el cuerpo.
 */

import { create } from "zustand";
import {
  AI_KEY_HEADER,
  InvalidApiKeyError,
  fetchModels,
  fetchProviders,
} from "@/services/aiSettingsClient";
import {
  AI_SETTINGS_KEY,
  AI_SETTINGS_VERSION,
  DEFAULT_AI_EFFORT,
  DEFAULT_AI_PROVIDER,
  FALLBACK_AI_PROVIDERS,
  FALLBACK_AI_SERVER,
  defaultResearchSettings,
  emptyAiSettings,
  resolveVoiceProvider,
  type AiModel,
  type AiProvider,
  type AiServerDefaults,
  type AiSettings,
  type ImageQuality,
  type ResearchSettings,
} from "@/types/aiSettings";

type KeyStatus = "idle" | "checking" | "ok" | "invalid";

function readSettings(): AiSettings {
  const base = emptyAiSettings();
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return base;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    const s = parsed as Record<string, unknown>;

    const byProvider: AiSettings["byProvider"] = {};
    if (s.byProvider && typeof s.byProvider === "object") {
      for (const [id, value] of Object.entries(s.byProvider as object)) {
        if (!value || typeof value !== "object") continue;
        const v = value as Record<string, unknown>;
        byProvider[id] = {
          apiKey: typeof v.apiKey === "string" ? v.apiKey : "",
          model: typeof v.model === "string" ? v.model : "",
        };
      }
    }

    return {
      version: AI_SETTINGS_VERSION,
      provider: typeof s.provider === "string" ? s.provider : base.provider,
      effort: typeof s.effort === "string" ? s.effort : base.effort,
      byProvider,
      imageModel: typeof s.imageModel === "string" ? s.imageModel : "",
      imageQuality: isQuality(s.imageQuality) ? s.imageQuality : "medium",
      researchProvider:
        s.researchProvider === "openai" || s.researchProvider === "google"
          ? s.researchProvider
          : "propio",
      research: readResearch(s.research),
      localBooks: readLocalBooks(s.localBooks),
      voiceProvider: typeof s.voiceProvider === "string" ? s.voiceProvider : "",
      voiceMode: typeof s.voiceMode === "string" ? s.voiceMode : "",
      sttModel: typeof s.sttModel === "string" ? s.sttModel : "",
      ttsVoice: typeof s.ttsVoice === "string" ? s.ttsVoice : "",
      speakBack: s.speakBack === true,
    };
  } catch {
    return base;
  }
}

function isQuality(value: unknown): value is ImageQuality {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * Ajustes de investigación guardados, campo a campo.
 *
 * Cada uno cae al default por separado en vez de descartar el objeto entero
 * ante un campo raro: al subir de la versión 1 a la 2 el objeto no existía, y
 * quien tuviera algo guardado se quedaría sin la mitad de sus preferencias por
 * una clave nueva.
 */
function readResearch(raw: unknown): ResearchSettings {
  const base = defaultResearchSettings();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const minYear =
    typeof r.minYear === "number" && Number.isFinite(r.minYear)
      ? Math.trunc(r.minYear)
      : null;

  return {
    internet: typeof r.internet === "boolean" ? r.internet : base.internet,
    minYear,
  };
}

/**
 * Los símbolos de los libros autorizados, saneados.
 *
 * Se filtra a cadenas no vacías en vez de confiar en lo guardado: esto acaba
 * decidiendo qué contenido del usuario sale de su dispositivo, y un `null`
 * colado en el array haría que la búsqueda pidiera a IndexedDB una clave que no
 * existe. Ante la duda, mejor un libro de menos que un error en el envío.
 */
function readLocalBooks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.trim() !== "");
}

function writeSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Safari privado o cuota llena: la sesión sigue funcionando en memoria.
  }
}

interface AiSettingsState {
  settings: AiSettings;
  providers: AiProvider[];
  server: AiServerDefaults;
  models: AiModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelsNotice: string | null;
  keyStatus: KeyStatus;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setProvider: (provider: string) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setEffort: (effort: string) => void;
  setImageModel: (model: string) => void;
  setImageQuality: (quality: ImageQuality) => void;
  setResearch: (patch: Partial<ResearchSettings>) => void;
  /** Marca o desmarca una publicación .jwpub para el chat. */
  toggleLocalBook: (symbol: string) => void;
  setVoiceProvider: (provider: string) => void;
  setVoiceMode: (mode: string) => void;
  setSttModel: (model: string) => void;
  setTtsVoice: (voice: string) => void;
  setSpeakBack: (speak: boolean) => void;
  refreshModels: (purpose?: "chat" | "image" | "research") => Promise<void>;
  clearKey: () => void;
}

function persist(
  set: (partial: Partial<AiSettingsState>) => void,
  next: AiSettings,
): void {
  writeSettings(next);
  set({ settings: next });
}

export const useAiSettingsStore = create<AiSettingsState>()((set, get) => ({
  settings: readSettings(),
  providers: FALLBACK_AI_PROVIDERS,
  server: FALLBACK_AI_SERVER,
  models: [],
  modelsLoading: false,
  modelsError: null,
  modelsNotice: null,
  keyStatus: "idle",
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true, settings: readSettings() });
    const catalog = await fetchProviders();
    set({ providers: catalog.providers, server: catalog.server });
    // La lista de modelos se carga sola. Antes solo se llenaba si ibas a
    // Ajustes y pulsabas "Comprobar y cargar modelos", así que el selector
    // rápido del chat no ofrecía NUNCA ningún modelo y parecía roto.
    // `/api/ai/models` responde sin key (devuelve el catálogo de respaldo),
    // así que esto funciona igual en modo servidor que con key propia.
    await get().refreshModels("chat");
  },

  setProvider: (provider) => {
    const next = { ...get().settings, provider };
    persist(set, next);
    // La lista de modelos es de OTRO proveedor: mostrarla sería mentir.
    set({ models: [], modelsError: null, modelsNotice: null, keyStatus: "idle" });
    void get().refreshModels("chat");
  },

  setApiKey: (apiKey) => {
    const { settings } = get();
    const current = settings.byProvider[settings.provider] ?? { apiKey: "", model: "" };
    persist(set, {
      ...settings,
      byProvider: {
        ...settings.byProvider,
        [settings.provider]: { ...current, apiKey: apiKey.trim() },
      },
    });
    set({ keyStatus: "idle", modelsError: null });
  },

  setModel: (model) => {
    const { settings } = get();
    const current = settings.byProvider[settings.provider] ?? { apiKey: "", model: "" };
    persist(set, {
      ...settings,
      byProvider: {
        ...settings.byProvider,
        [settings.provider]: { ...current, model },
      },
    });
  },

  setEffort: (effort) => persist(set, { ...get().settings, effort }),

  setImageModel: (imageModel) => persist(set, { ...get().settings, imageModel }),

  setImageQuality: (imageQuality) =>
    persist(set, { ...get().settings, imageQuality }),

  setResearch: (patch) => {
    const { settings } = get();
    persist(set, { ...settings, research: { ...settings.research, ...patch } });
  },

  toggleLocalBook: (symbol) => {
    const { settings } = get();
    const marcados = settings.localBooks.includes(symbol)
      ? settings.localBooks.filter((s) => s !== symbol)
      : [...settings.localBooks, symbol];
    persist(set, { ...settings, localBooks: marcados });
  },

  setVoiceProvider: (voiceProvider) => {
    // El modelo de STT es de OTRO proveedor: conservarlo mandaría "whisper-1"
    // a un proveedor que no lo tiene y el backend lo degradaría en silencio.
    // Mejor vaciarlo y que cada uno use su default.
    persist(set, { ...get().settings, voiceProvider, sttModel: "", ttsVoice: "" });
  },

  setVoiceMode: (voiceMode) => persist(set, { ...get().settings, voiceMode }),

  setSttModel: (sttModel) => persist(set, { ...get().settings, sttModel }),

  setTtsVoice: (ttsVoice) => persist(set, { ...get().settings, ttsVoice }),

  setSpeakBack: (speakBack) => persist(set, { ...get().settings, speakBack }),

  refreshModels: async (purpose = "chat") => {
    const { settings } = get();
    const apiKey = settings.byProvider[settings.provider]?.apiKey ?? "";

    set({ modelsLoading: true, modelsError: null, keyStatus: apiKey ? "checking" : "idle" });
    try {
      const result = await fetchModels(settings.provider, purpose, apiKey);
      set({
        models: result.models,
        modelsNotice: result.notice,
        modelsLoading: false,
        keyStatus: apiKey && result.source === "api" ? "ok" : "idle",
      });
    } catch (error) {
      const message =
        error instanceof InvalidApiKeyError
          ? error.message
          : "No se pudo cargar la lista de modelos.";
      set({
        modelsLoading: false,
        modelsError: message,
        keyStatus: error instanceof InvalidApiKeyError ? "invalid" : "idle",
      });
    }
  },

  clearKey: () => {
    const { settings } = get();
    const current = settings.byProvider[settings.provider];
    if (!current) return;
    persist(set, {
      ...settings,
      byProvider: {
        ...settings.byProvider,
        [settings.provider]: { ...current, apiKey: "" },
      },
    });
    set({ models: [], keyStatus: "idle", modelsError: null });
  },
}));

// ─── Getters para los clientes HTTP ──────────────────────────────

/** La key del proveedor activo, o cadena vacía si no hay ninguna. */
export function currentApiKey(): string {
  const { settings } = useAiSettingsStore.getState();
  return settings.byProvider[settings.provider]?.apiKey ?? "";
}

/**
 * Los símbolos .jwpub que el usuario ha autorizado para el chat.
 *
 * Getter con nombre y no un acceso suelto al store: es el único punto desde el
 * que se decide qué biblioteca del usuario sale de su dispositivo, y conviene
 * que se vea en el grep.
 */
export function localBooksForChat(): string[] {
  return useAiSettingsStore.getState().settings.localBooks;
}

/** El modelo elegido para el proveedor activo, o cadena vacía. */
export function currentModel(): string {
  const { settings } = useAiSettingsStore.getState();
  return settings.byProvider[settings.provider]?.model ?? "";
}

/**
 * Cabeceras de una petición al backend.
 *
 * `{}` cuando no hay key: la petición sale byte a byte igual que antes de que
 * existiera todo esto, y el backend responde con su runtime de servidor.
 */
export function aiRequestHeaders(): Record<string, string> {
  const apiKey = currentApiKey();
  return apiKey ? { [AI_KEY_HEADER]: apiKey } : {};
}

/**
 * El proveedor de voz que se va a usar de verdad, ya resuelto.
 *
 * Devuelve `undefined` cuando NINGÚN proveedor tiene voz verificada: la
 * pantalla lo usa para explicar por qué no puede grabar en vez de ofrecer un
 * botón que daría 400.
 */
export function currentVoiceProvider() {
  const { settings, providers } = useAiSettingsStore.getState();
  return resolveVoiceProvider(providers, settings.voiceProvider);
}

/**
 * Cabeceras de una petición de voz.
 *
 * NO se puede reutilizar `aiRequestHeaders()`: esa devuelve la key del
 * proveedor de CHAT, y el de voz puede ser otro (chat en Gemini, voz en
 * OpenAI, que es la combinación más probable hoy). Mandar la key de Gemini a
 * OpenAI daría un 401 desconcertante.
 */
export function voiceRequestHeaders(): Record<string, string> {
  const provider = currentVoiceProvider();
  if (!provider) return {};

  const { settings } = useAiSettingsStore.getState();
  const apiKey = settings.byProvider[provider.id]?.apiKey ?? "";
  return apiKey ? { [AI_KEY_HEADER]: apiKey } : {};
}

/**
 * Campos del cuerpo. Nunca la key: eso solo va en la cabecera.
 *
 * El esfuerzo viaja SIEMPRE. Antes se enviaba solo si había key propia o
 * modelo elegido, y como lo normal es usar la key del servidor, cambiar el
 * esfuerzo no hacía absolutamente nada: se guardaba en el dispositivo y ahí se
 * quedaba. El backend acepta modelo y esfuerzo también en modo servidor
 * (CHAT_ALLOW_CLIENT_MODEL), así que no hay razón para retenerlos.
 *
 * `provider` sí depende de la key: en modo servidor el proveedor lo decide el
 * servidor, y mandarlo solo confundiría.
 *
 * **El modelo tiene que ir con SU proveedor o no ir.** Este es el fallo que
 * dejaba a Google y a MiniMax sin funcionar en producción: al elegirlos sin
 * pegar su clave, no se mandaba `provider` (correcto, lo sirve el servidor)
 * pero sí `model`, así que a OpenAI le llegaba un nombre de modelo de Gemini y
 * contestaba «The model `gemini-3.5-flash` does not exist». Para el usuario
 * era un "error de servidor" inexplicable, y ni el modelo ni el proveedor
 * estaban rotos: el cuerpo de la petición era incoherente.
 *
 * Regla: el modelo solo viaja cuando quien va a atender la petición lo
 * entiende — o porque hay key propia (entonces manda el proveedor elegido) o
 * porque el proveedor elegido coincide con el del servidor. Si no, se omite y
 * el servidor usa su modelo por defecto, que es lo correcto y además funciona.
 */
export function aiRequestBody(): {
  provider?: string;
  model?: string;
  effort?: string;
  research?: { internet: boolean; min_year: number | null };
} {
  const { settings, server } = useAiSettingsStore.getState();
  const conKeyPropia = Boolean(currentApiKey());
  const r = settings.research;

  // Con key propia atiende el proveedor elegido; sin ella, el del servidor.
  const atiende = conKeyPropia ? settings.provider : server.provider;
  const model = atiende === settings.provider ? currentModel() : "";

  return {
    ...(conKeyPropia && settings.provider ? { provider: settings.provider } : {}),
    ...(model ? { model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    // Va SIEMPRE, no solo cuando difiere del default. El backend tiene sus
    // propios valores por defecto y si no mandamos nada gana el suyo; con
    // interruptores que el usuario puede APAGAR, "no mandar nada" significaría
    // que apagarlos no hace nada — que es justo el bug que tuvo el esfuerzo.
    research: { internet: r.internet, min_year: r.minYear },
  };
}

export { DEFAULT_AI_EFFORT, DEFAULT_AI_PROVIDER };
