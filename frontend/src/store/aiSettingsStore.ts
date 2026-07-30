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
  emptyAiSettings,
  type AiModel,
  type AiProvider,
  type AiServerDefaults,
  type AiSettings,
  type ImageQuality,
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
    };
  } catch {
    return base;
  }
}

function isQuality(value: unknown): value is ImageQuality {
  return value === "low" || value === "medium" || value === "high";
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
  },

  setProvider: (provider) => {
    const next = { ...get().settings, provider };
    persist(set, next);
    // La lista de modelos es de OTRO proveedor: mostrarla sería mentir.
    set({ models: [], modelsError: null, modelsNotice: null, keyStatus: "idle" });
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
 * Campos del cuerpo. Nunca la key: eso solo va en la cabecera.
 *
 * Se omiten los campos vacíos para que un usuario sin configurar mande
 * exactamente el mismo cuerpo de siempre.
 */
export function aiRequestBody(): {
  provider?: string;
  model?: string;
  effort?: string;
} {
  const { settings } = useAiSettingsStore.getState();
  const model = currentModel();
  const configured = Boolean(currentApiKey()) || Boolean(model);
  if (!configured) return {};

  return {
    ...(settings.provider ? { provider: settings.provider } : {}),
    ...(model ? { model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  };
}

export { DEFAULT_AI_EFFORT, DEFAULT_AI_PROVIDER };
