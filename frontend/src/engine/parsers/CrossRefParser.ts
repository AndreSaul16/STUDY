import type { DetectedReference, Reference, ReferenceParser } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";

/**
 * CrossRefParser — detecta referencias cruzadas genéricas.
 *
 * Cubre:
 *  - "cf. Salmo 23" / "cfr. Juan 3"
 *  - "véase Salmo 23:1" / "véase también Juan 3:16"
 *  - "compárese con Romanos 8"
 *  - "cf. La Atalaya 2023"
 *
 * A diferencia de ScriptureParser, este captura el prefijo ("cf.", "véase")
 * como parte del match y delega el destino al parser correspondiente.
 * El destino se almacena en `publication` como texto libre.
 *
 * Normaliza a:
 *   publication = destino (texto libre, ej: "Salmo 23:1")
 *   chapter = null
 *   paragraph = null
 *   identifier = "crossref:{destino_normalizado}"
 */

const PREFIXES = [
  "cf\\.",
  "cfr\\.",
  "véase\\s+también",
  "véase",
  "compárese\\s+con",
  "consúltese",
  "ver\\s+también",
] as const;

const prefixesPattern = PREFIXES.join("|");

// Captura el prefijo + el destino (hasta puntuación fuerte o fin de línea)
const CROSSREF_REGEX = new RegExp(
  [
    `\\b(${prefixesPattern})\\s+`,
    // Destino: palabras, números, dos puntos, guiones (para "Salmo 23:1-6")
    "([A-Za-záéíóúÁÉÍÓÚñÑ0-9][A-Za-záéíóúÁÉÍÓÚñÑ0-9\\s:\\-]{1,60}?)",
    // Límite: puntuación fuerte, fin de línea, o palabra no relacionada
    "(?=[.,;:!?)\\]\\s]|$)",
  ].join(""),
  "giu",
);

function normalizeDest(dest: string): string {
  return dest
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ: -]/g, "")
    .replace(/\s+/g, "_");
}

export class CrossRefParser implements ReferenceParser {
  readonly type = REFERENCE_TYPES.CROSS_REFERENCE;

  parse(text: string): DetectedReference[] {
    const results: DetectedReference[] = [];
    const regex = new RegExp(CROSSREF_REGEX.source, "giu");
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      const dest = m[2]!.trim();
      if (dest.length < 3) continue; // filtrar destinos triviales

      const identifier = `crossref:${normalizeDest(dest)}`;
      const reference: Reference = {
        type: REFERENCE_TYPES.CROSS_REFERENCE,
        publication: dest,
        chapter: null,
        paragraph: null,
        identifier,
      };

      results.push({
        reference,
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
      });
    }

    return results;
  }
}
