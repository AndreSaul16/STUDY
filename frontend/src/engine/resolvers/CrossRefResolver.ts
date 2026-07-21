import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";

/**
 * CrossRefResolver — referencias cruzadas genéricas.
 *
 * Aún no hay resolución real. En vez de contenido mock inventado, informa
 * claramente de que no está disponible.
 */
export class CrossRefResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.CROSS_REFERENCE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    return {
      reference: ref,
      title: ref.publication ?? "Referencia cruzada",
      body: "Contenido no disponible sin conexión a la publicación.",
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.UNAVAILABLE,
    };
  }
}
