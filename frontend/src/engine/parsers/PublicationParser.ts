import type { DetectedReference, Reference, ReferenceParser } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";

/**
 * PublicationParser — detecta referencias a publicaciones periódicas.
 *
 * Cubre:
 *  - "La Atalaya 2023" / "La Atalaya julio 2023"
 *  - "¡Despertad! 2022" / "¡Despertad! marzo 2022"
 *  - "Benefíciese de la Escuela del Ministerio Teocrático"
 *  - "Libro del Año 2024"
 *  - "Estudio de la Atalaya"
 *
 * Normaliza a:
 *   publication = nombre de la publicación
 *   chapter = año (si detecta)
 *   paragraph = número de página o edición (si detecta)
 *   identifier = "publication:{nombre}:{año}:{edicion}"
 */

const PUBLICATION_NAMES = [
  "La Atalaya",
  "¡Despertad!",
  "Benefíciese de la Escuela del Ministerio Teocrático",
  "Libro del Año",
  "Anuario",
  "Ministerio del Reino",
  "Nuestro Ministerio del Reino",
  "Vida y Ministerio",
  "Libro bíblico",
  "Folleto",
  "Libro",
] as const;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const namesPattern = PUBLICATION_NAMES
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join("|");

// Regex: (nombre) + año opcional + mes/edición opcional
const PUBLICATION_REGEX = new RegExp(
  [
    "(?<![\\w])",
    `(${namesPattern})`,
    // Opcional: "estudio de" o "edición"
    "(?:\\s+(?:estudio\\s+de\\s+(?:la\\s+)?|edición\\s+))?",
    // Grupo 2: año (4 dígitos)
    "(?:(\\d{4}))?",
    // Opcional: mes o número de edición
    "(?:\\s+([A-Za-záéíóú]+|n\\.?\\s*\\d{1,3}))?",
    "(?![\\w])",
  ].join(""),
  "giu",
);

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

function parseEdition(raw: string | undefined): number | null {
  if (!raw) return null;
  // "n. 3" o "n.3"
  const nMatch = raw.match(/n\.?\s*(\d{1,3})/i);
  if (nMatch) return parseInt(nMatch[1]!, 10);
  // Mes → número de mes
  const monthIdx = MONTHS.indexOf(raw.toLowerCase() as (typeof MONTHS)[number]);
  if (monthIdx >= 0) return monthIdx + 1;
  return null;
}

export class PublicationParser implements ReferenceParser {
  readonly type = REFERENCE_TYPES.PUBLICATION;

  parse(text: string): DetectedReference[] {
    const results: DetectedReference[] = [];
    const regex = new RegExp(PUBLICATION_REGEX.source, "giu");
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      const name = m[1]!.trim();
      const year = m[2] ? parseInt(m[2]!, 10) : null;
      const editionRaw = m[3]?.trim();
      const edition = parseEdition(editionRaw);

      const identifier = `publication:${name.toLowerCase().replace(/\s+/g, "_")}:${year ?? "s.a."}:${edition ?? "s.e."}`;

      const reference: Reference = {
        type: REFERENCE_TYPES.PUBLICATION,
        publication: name,
        chapter: year,
        paragraph: edition,
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
