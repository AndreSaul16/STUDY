/**
 * referenceClient — cliente HTTP de resolución de contenido contra el backend.
 *
 * Tres operaciones, todas contra wol.jw.org en ESPAÑOL:
 *   resolveScripture — texto de un versículo o capítulo
 *   searchLibrary    — búsqueda en la Biblioteca en Línea
 *   fetchDocument    — artículo completo, ya troceado en bloques
 */

import { API_BASE } from "@/services/apiBase";

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

// ─── Biblioteca en Línea ─────────────────────────────────────────

export interface LibrarySearchResult {
  doc_id: number;
  citation: string;
  snippet: string;
  publication: string;
  url: string;
}

export interface WolBlock {
  block_id: number;
  block_type: string;
  content: string;
}

export interface WolDocument {
  doc_id: number;
  title: string;
  citation: string;
  url: string;
  blocks: WolBlock[];
}

/** Busca publicaciones (Atalaya, libros, guía) en wol.jw.org. */
export async function searchLibrary(
  query: string,
  limit = 8,
): Promise<LibrarySearchResult[]> {
  const qs = `?q=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetch(`${API_BASE}/api/references/search${qs}`);

  if (!response.ok) {
    throw new Error("No se pudo buscar en la biblioteca");
  }

  const data: { results: LibrarySearchResult[] } = await response.json();
  return data.results;
}

/** Descarga un artículo completo de la Biblioteca en Línea. */
export async function fetchDocument(docId: number): Promise<WolDocument> {
  const response = await fetch(`${API_BASE}/api/references/document/${docId}`);

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No se encontró el documento"
        : "No se pudo abrir el documento",
    );
  }

  return response.json();
}
