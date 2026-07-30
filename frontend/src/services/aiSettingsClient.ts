/**
 * aiSettingsClient — catálogo de proveedores y listado de modelos.
 *
 * Mismo criterio defensivo que `fetchChatModes`: **nunca lanza** por un fallo
 * de red, porque Ajustes tiene que poder abrirse con el backend a medio
 * arrancar. La única excepción es el 401, que sí se distingue: ahí el usuario
 * TIENE que enterarse de que su key no vale, y un respaldo silencioso se lo
 * ocultaría.
 *
 * La key viaja únicamente en la cabecera `X-AI-Api-Key`. `fetchModels` es POST
 * a propósito: en un GET la key acabaría en la query string, o sea en el
 * historial del navegador y en los logs del proxy.
 */

import { API_BASE } from "@/services/apiBase";
import {
  FALLBACK_AI_PROVIDERS,
  FALLBACK_AI_SERVER,
  type AiModel,
  type AiModelsResponse,
  type AiProvider,
  type AiProvidersResponse,
} from "@/types/aiSettings";

const PROVIDERS_ENDPOINT = `${API_BASE}/api/ai/providers`;
const MODELS_ENDPOINT = `${API_BASE}/api/ai/models`;

/** Cabecera por la que viaja la key del usuario. */
export const AI_KEY_HEADER = "X-AI-Api-Key";

export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiKeyError";
  }
}

function isProvider(value: unknown): value is AiProvider {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    Array.isArray(p.efforts)
  );
}

function toModel(value: unknown): AiModel[] {
  if (!value || typeof value !== "object") return [];
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id) return [];
  return [
    {
      id: m.id,
      label: typeof m.label === "string" && m.label ? m.label : m.id,
      description: typeof m.description === "string" ? m.description : "",
      family: typeof m.family === "string" ? m.family : "",
      reasoning: m.reasoning === true,
      context: typeof m.context === "number" ? m.context : null,
      recommended: m.recommended === true,
    },
  ];
}

/** Catálogo de proveedores. Nunca lanza: cae a la copia local. */
export async function fetchProviders(): Promise<AiProvidersResponse> {
  const fallback: AiProvidersResponse = {
    providers: FALLBACK_AI_PROVIDERS,
    server: FALLBACK_AI_SERVER,
  };

  try {
    const response = await fetch(PROVIDERS_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallback;

    const raw = payload as Record<string, unknown>;
    const providers = Array.isArray(raw.providers)
      ? raw.providers.filter(isProvider)
      : [];
    if (providers.length === 0) return fallback;

    const server = raw.server as Record<string, unknown> | undefined;
    return {
      providers,
      server: {
        provider: typeof server?.provider === "string" ? server.provider : "openai",
        model: typeof server?.model === "string" ? server.model : "",
        effort: typeof server?.effort === "string" ? server.effort : "ninguno",
        has_server_key: server?.has_server_key === true,
      },
    };
  } catch {
    return fallback;
  }
}

/**
 * Modelos disponibles para una key.
 *
 * Es además la comprobación de la key: si devuelve la lista, la key sirve.
 * Lanza `InvalidApiKeyError` SOLO en el 401 —lo demás degrada a la lista de
 * respaldo que manda el propio backend.
 */
export async function fetchModels(
  provider: string,
  purpose: "chat" | "image" | "research",
  apiKey: string,
): Promise<AiModelsResponse> {
  const empty: AiModelsResponse = {
    provider,
    purpose,
    models: [],
    source: "fallback",
    notice: "No se pudo contactar con el servidor.",
  };

  let response: Response;
  try {
    response = await fetch(MODELS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(apiKey ? { [AI_KEY_HEADER]: apiKey } : {}),
      },
      body: JSON.stringify({ provider, purpose }),
    });
  } catch {
    return empty;
  }

  if (response.status === 401 || response.status === 403) {
    const detail = await readDetail(response);
    throw new InvalidApiKeyError(detail || "Esa API key no es válida.");
  }
  if (!response.ok) {
    const detail = await readDetail(response);
    return { ...empty, notice: detail || empty.notice };
  }

  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return empty;
    const raw = payload as Record<string, unknown>;
    const models = Array.isArray(raw.models) ? raw.models.flatMap(toModel) : [];

    return {
      provider: typeof raw.provider === "string" ? raw.provider : provider,
      purpose: typeof raw.purpose === "string" ? raw.purpose : purpose,
      models,
      source: raw.source === "api" ? "api" : "fallback",
      notice: typeof raw.notice === "string" ? raw.notice : null,
    };
  } catch {
    return empty;
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    const detail = (payload as Record<string, unknown> | null)?.detail;
    return typeof detail === "string" ? detail : "";
  } catch {
    return "";
  }
}
