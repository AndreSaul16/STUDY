/**
 * referenceClient — cliente HTTP para resolver referencias bíblicas.
 *
 * Conecta con el backend FastAPI en /api/references/resolve, que obtiene el
 * texto real del versículo desde wol.jw.org en español (fallback MCP inglés).
 */

const API_BASE = import.meta.env.VITE_AI_API_BASE ?? "http://localhost:8000";

export interface ResolvedScripture {
  identifier: string;
  title: string;
  content: string;
  source_url: string;
  /** "wol" (español) o "mcp" (fallback inglés). */
  source: string;
}

/**
 * Resuelve un identificador de escritura (ej. "scripture:efesios:4:15").
 * Lanza Error si el backend no devuelve 200.
 */
export async function resolveScripture(
  identifier: string,
): Promise<ResolvedScripture> {
  const qs = `?identifier=${encodeURIComponent(identifier)}`;
  const response = await fetch(`${API_BASE}/api/references/resolve${qs}`);

  if (!response.ok) {
    throw new Error("No se pudo resolver la referencia");
  }

  return response.json();
}
