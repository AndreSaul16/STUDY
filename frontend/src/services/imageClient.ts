/**
 * imageClient — generación de ilustraciones.
 *
 * La key viaja en la cabecera `X-AI-Api-Key` (nunca en el cuerpo ni en la URL)
 * gracias a `aiRequestHeaders()`, que es donde vive esa decisión.
 *
 * A diferencia del resto de clientes de la app, este SÍ lanza: generar una
 * imagen cuesta dinero y tarda un minuto, así que un fallo silencioso con
 * degradado a "no pasa nada" sería exactamente lo contrario de lo que el
 * usuario necesita saber.
 */

import { API_BASE } from "@/services/apiBase";
import { aiRequestHeaders } from "@/store/aiSettingsStore";
import type { ImageQuality } from "@/types/aiSettings";

const IMAGES_ENDPOINT = `${API_BASE}/api/images/generate`;

export interface GeneratedImagePayload {
  b64: string;
  mime: string;
  width: number;
  height: number;
  revised_prompt: string;
}

export interface ImageGenerationResult {
  provider: string;
  model: string;
  /** El prompt final, con la salvaguarda de contenido que añade el backend. */
  prompt: string;
  images: GeneratedImagePayload[];
  elapsed_ms: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  provider?: string;
  model?: string;
  size?: string;
  quality?: ImageQuality;
  n?: number;
}

export async function generateImage(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const response = await fetch(IMAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...aiRequestHeaders(),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      const value = (payload as Record<string, unknown> | null)?.detail;
      if (typeof value === "string") detail = value;
    } catch {
      detail = "";
    }
    throw new Error(detail || "No se pudo generar la ilustración.");
  }

  return (await response.json()) as ImageGenerationResult;
}

/** `data:` URI listo para un `<img src>`. */
export function toDataUri(mime: string, b64: string): string {
  return `data:${mime};base64,${b64}`;
}

/** Coste aproximado por imagen, en dólares. Para enseñarlo ANTES de gastar. */
const PRICE_PER_IMAGE: Record<string, Record<ImageQuality, number>> = {
  "gpt-image-1-mini": { low: 0.005, medium: 0.011, high: 0.052 },
  "gpt-image-1.5": { low: 0.009, medium: 0.035, high: 0.2 },
  "gpt-image-2": { low: 0.005, medium: 0.04, high: 0.211 },
  "gemini-2.5-flash-image": { low: 0.02, medium: 0.04, high: 0.04 },
  "gemini-3-pro-image-preview": { low: 0.06, medium: 0.12, high: 0.24 },
};

/**
 * "≈ 0,01 $" — estimación honesta, con el "≈" bien visible.
 *
 * Los precios de Gemini por imagen no están confirmados; se marcan como
 * aproximados igual que los demás y nunca se presentan como factura.
 */
export function estimatedCost(
  model: string,
  quality: ImageQuality,
  n: number,
): string {
  const table = PRICE_PER_IMAGE[model];
  if (!table) return "coste variable";
  const total = table[quality] * Math.max(1, n);
  return `≈ ${total.toFixed(total < 0.1 ? 3 : 2).replace(".", ",")} $`;
}
