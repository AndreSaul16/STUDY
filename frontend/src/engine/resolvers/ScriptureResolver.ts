import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { resolveScripture } from "@/services/referenceClient";

/**
 * ScriptureResolver — resuelve referencias bíblicas contra el backend.
 *
 * Hace fetch a `GET /api/references/resolve?identifier=...`, que obtiene el
 * texto real del versículo desde wol.jw.org en español (con fallback al MCP
 * en inglés). Ya NO usa datos mock.
 */
export class ScriptureResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.SCRIPTURE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    try {
      const data = await resolveScripture(ref.identifier);
      // El backend marca source "wol" (español) o "mcp" (fallback inglés).
      const source =
        data.source === RESOLUTION_SOURCES.MCP
          ? RESOLUTION_SOURCES.MCP
          : RESOLUTION_SOURCES.WOL;
      return {
        reference: ref,
        title: data.title,
        body: data.content,
        subtitle: source === RESOLUTION_SOURCES.MCP ? "Fuente: MCP (inglés)" : undefined,
        resolvedAt: Date.now(),
        source,
      };
    } catch {
      return {
        reference: ref,
        title: ref.publication
          ? `${ref.publication} ${ref.chapter ?? ""}${
              ref.paragraph ? `:${ref.paragraph}` : ""
            }`.trim()
          : "Referencia no disponible",
        body: "No se pudo obtener el texto de esta referencia en este momento.",
        resolvedAt: Date.now(),
        source: RESOLUTION_SOURCES.UNAVAILABLE,
      };
    }
  }
}
