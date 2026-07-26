import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { ScriptureParser } from "@/engine/parsers/ScriptureParser";
import { resolveScripture, searchLibrary, fetchDocument } from "@/services/referenceClient";

const PREVIEW_CHARS = 1200;

/**
 * CrossRefResolver — referencias cruzadas ("cf. Salmo 23", "véase La Atalaya…").
 *
 * El parser guarda el destino como texto libre en `publication`, así que aquí
 * hay que averiguar qué es ese destino antes de poder resolverlo:
 *
 *   1. ¿Es una cita bíblica? → se resuelve como escritura (texto real en español).
 *   2. Si no → se busca en la Biblioteca en Línea y se abre el mejor resultado.
 *
 * Antes devolvía siempre "Contenido no disponible".
 */
export class CrossRefResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.CROSS_REFERENCE;

  private readonly scriptureParser = new ScriptureParser();

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const destination = (ref.publication ?? "").trim();
    if (!destination) {
      return unavailable(ref, "Esta referencia no indica un destino.");
    }

    // 1) ¿El destino es una cita bíblica? Reutilizamos el parser en vez de
    //    duplicar la gramática de nombres de libros y rangos de versículos.
    const [scripture] = this.scriptureParser.parse(destination);
    if (scripture) {
      try {
        const data = await resolveScripture(scripture.reference.identifier);
        return {
          reference: ref,
          title: data.title,
          subtitle: `Referencia cruzada · ${destination}`,
          body: data.content,
          resolvedAt: Date.now(),
          source:
            data.source === RESOLUTION_SOURCES.MCP
              ? RESOLUTION_SOURCES.MCP
              : RESOLUTION_SOURCES.WOL,
        };
      } catch {
        return unavailable(ref, "No se pudo obtener el texto de esta cita.");
      }
    }

    // 2) Si no es una cita, tratarlo como publicación y buscarla.
    try {
      const [best] = await searchLibrary(destination, 1);
      if (!best) {
        return unavailable(
          ref,
          `No se encontró «${destination}» en wol.jw.org.`,
        );
      }

      const doc = await fetchDocument(best.doc_id);
      return {
        reference: ref,
        title: doc.title,
        subtitle: best.citation || `Referencia cruzada · ${destination}`,
        body: doc.blocks
          .map((block) => block.content)
          .join("\n\n")
          .slice(0, PREVIEW_CHARS),
        resolvedAt: Date.now(),
        source: RESOLUTION_SOURCES.WOL,
      };
    } catch {
      return unavailable(ref, "No se pudo resolver esta referencia ahora mismo.");
    }
  }
}

function unavailable(ref: Reference, message: string): ResolvedReference {
  return {
    reference: ref,
    title: ref.publication ?? "Referencia cruzada",
    body: message,
    resolvedAt: Date.now(),
    source: RESOLUTION_SOURCES.UNAVAILABLE,
  };
}
