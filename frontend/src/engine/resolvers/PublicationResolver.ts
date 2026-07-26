import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { searchLibrary, fetchDocument } from "@/services/referenceClient";

/** Cuánto texto del artículo se muestra en la tarjeta de referencia. */
const PREVIEW_CHARS = 1200;

/**
 * PublicationResolver — referencias a publicaciones (Atalaya, libros, guía).
 *
 * Antes devolvía siempre "Contenido no disponible". Ahora busca la referencia
 * en la Biblioteca en Línea vía el backend y abre el primer resultado, de modo
 * que una cita como «w06 1/12 pág. 25» muestra el texto real del artículo.
 *
 * No siempre habrá acierto (las citas abreviadas son ambiguas); en ese caso se
 * dice claramente que no se encontró, en vez de inventar contenido.
 */
export class PublicationResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.PUBLICATION;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const query = buildQuery(ref);

    try {
      const results = await searchLibrary(query, 1);
      const best = results[0];

      if (!best) {
        return unavailable(ref, "No se encontró esta publicación en wol.jw.org.");
      }

      const doc = await fetchDocument(best.doc_id);
      const body = doc.blocks
        .map((block) => block.content)
        .join("\n\n")
        .slice(0, PREVIEW_CHARS);

      return {
        reference: ref,
        title: doc.title,
        subtitle: best.citation || undefined,
        body,
        resolvedAt: Date.now(),
        source: RESOLUTION_SOURCES.WOL,
      };
    } catch {
      return unavailable(
        ref,
        "No se pudo obtener el contenido de esta publicación ahora mismo.",
      );
    }
  }
}

/** Reconstruye un término de búsqueda legible a partir de la referencia. */
function buildQuery(ref: Reference): string {
  return [ref.publication, ref.chapter, ref.paragraph]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")
    .trim() || ref.identifier;
}

function unavailable(ref: Reference, message: string): ResolvedReference {
  return {
    reference: ref,
    title: ref.publication ?? "Publicación",
    body: message,
    resolvedAt: Date.now(),
    source: RESOLUTION_SOURCES.UNAVAILABLE,
  };
}
