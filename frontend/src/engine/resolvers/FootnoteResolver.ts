import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";

/**
 * FootnoteResolver — notas del autor y notas al pie.
 *
 * No está registrado en el registry por defecto (ver `registry.ts`): ninguna
 * de las fuentes que servimos trae el cuerpo de la nota, así que detectarlas
 * sólo producía enlaces muertos. Se conserva para activarlo en cuanto el
 * lector de .jwpub extraiga la tabla de notas.
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
