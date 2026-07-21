import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";

/**
 * PublicationResolver — referencias a publicaciones periódicas.
 *
 * Aún no hay resolución real contra la publicación online. En vez de mostrar
 * contenido mock inventado, informa claramente de que no está disponible.
 */
export class PublicationResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.PUBLICATION;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    return {
      reference: ref,
      title: ref.publication ?? "Publicación",
      body: "Contenido no disponible sin conexión a la publicación.",
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.UNAVAILABLE,
    };
  }
}
