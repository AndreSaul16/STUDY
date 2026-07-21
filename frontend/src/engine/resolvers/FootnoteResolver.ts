import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";

/**
 * FootnoteResolver — notas del autor y notas al pie.
 *
 * Aún no hay resolución real. En vez de contenido mock inventado, informa
 * claramente de que no está disponible.
 */
export class FootnoteResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.FOOTNOTE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    return {
      reference: ref,
      title: "Nota",
      body: "Contenido no disponible sin conexión a la publicación.",
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.UNAVAILABLE,
    };
  }
}
