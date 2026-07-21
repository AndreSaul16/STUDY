import type { DetectedReference, Reference, ReferenceParser } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";

/**
 * ScriptureParser — detecta citas bíblicas en texto español.
 *
 * Cubre:
 *  - Libros con prefijo numérico: "1 Samuel", "2 Corintios", "3 Juan"
 *  - Libros simples: "Génesis", "Salmo 23", "Juan 3:16"
 *  - Rangos de versículos: "Salmo 23:1-6", "Juan 3:16-18"
 *  - Referencias con "capítulo" explícito: "Salmo capítulo 23 versículo 1"
 *  - Abreviaciones comunes: "Sal", "Jn", "1Co", "Gn", "Ex", "Lev", etc.
 *
 * Normaliza a:
 *   publication = nombre canónico del libro (ej: "Salmo")
 *   chapter = número de capítulo
 *   paragraph = número de versículo (o primer versículo del rango)
 *   identifier = "scripture:{libro}:{cap}:{versiculo}"
 */

// ─── Libros bíblicos canónicos en español ────────────────────────
// Ordenados por longitud descendente para que la regex matchee
// el nombre más largo primero (evita "Juan" robe de "1 Juan").
const BOOKS = [
  // Libros con prefijo numérico (tratados aparte)
  "1 Samuel", "2 Samuel", "1 Reyes", "2 Reyes",
  "1 Crónicas", "2 Crónicas", "1 Corintios", "2 Corintios",
  "1 Tesalonicenses", "2 Tesalonicenses",
  "1 Timoteo", "2 Timoteo", "1 Pedro", "2 Pedro",
  "1 Juan", "2 Juan", "3 Juan",

  // Libros largos primero
  "Cantares", "Deuteronomio", "Eclesiastés", "Ester",
  "Ezequiel", "Filemón", "Filipenses", "Gálatas",
  "Génesis", "Habacuc", "Hebreos", "Hechos",
  "Isaías", "Jeremías", "Job", "Joel",
  "Jonás", "Josué", "Juan", "Judás",
  "Lamentaciones", "Levítico", "Lucas", "Malaquías",
  "Marcos", "Mateo", "Miqueas", "Nahúm",
  "Nehemías", "Números", "Oseas", "Proverbios",
  "Romanos", "Rut", "Salmo", "Salmos",
  "Santiago", "Sofonías", "Zacarías", "Apocalipsis",
  "Abdías", "Amós", "Colosenses", "Éxodo",
  "Efesios", "Esdras", "Lev",

  // Abreviaciones comunes (se normalizan al canónico)
  "Sal", "Jn", "Gn", "Ex", "Lv", "Nm", "Dt", "Jos",
  "Jue", "Rt", "1S", "2S", "1R", "2R", "1Cr", "2Cr",
  "Esd", "Ne", "Est", "Job", "Pr", "Cnt", "Ec",
  "Is", "Jer", "Lm", "Ez", "Dn", "Os", "Jl", "Am",
  "Jon", "Mi", "Na", "Hab", "Sof", "Ag", "Za", "Mal",
  "Mt", "Mc", "Lc", "Hch", "Ro", "1Co", "2Co", "Gá",
  "Ef", "Flp", "Col", "1Ts", "2Ts", "1Ti", "2Ti",
  "Tit", "Flm", "Stg", "1P", "2P", "1Jn", "2Jn", "3Jn",
  "Jud", "Ap",
] as const;

// Mapa de abreviación → canónico
const ABBR_TO_CANONICAL: Record<string, string> = {
  Sal: "Salmo", Jn: "Juan", Gn: "Génesis", Ex: "Éxodo", Lv: "Levítico",
  Nm: "Números", Dt: "Deuteronomio", Jos: "Josué", Jue: "Jueces",
  Rt: "Rut", "1S": "1 Samuel", "2S": "2 Samuel", "1R": "1 Reyes",
  "2R": "2 Reyes", "1Cr": "1 Crónicas", "2Cr": "2 Crónicas",
  Esd: "Esdras", Ne: "Nehemías", Est: "Ester", Pr: "Proverbios",
  Cnt: "Cantares", Ec: "Eclesiastés", Is: "Isaías", Jer: "Jeremías",
  Lm: "Lamentaciones", Ez: "Ezequiel", Dn: "Daniel", Os: "Oseas",
  Jl: "Joel", Am: "Amós", Jon: "Jonás", Mi: "Miqueas", Na: "Nahúm",
  Hab: "Habacuc", Sof: "Sofonías", Ag: "Ageo", Za: "Zacarías",
  Mal: "Malaquías", Mt: "Mateo", Mc: "Marcos", Lc: "Lucas",
  Hch: "Hechos", Ro: "Romanos", "1Co": "1 Corintios", "2Co": "2 Corintios",
  Gá: "Gálatas", Ef: "Efesios", Flp: "Filipenses", Col: "Colosenses",
  "1Ts": "1 Tesalonicenses", "2Ts": "2 Tesalonicenses",
  "1Ti": "1 Timoteo", "2Ti": "2 Timoteo", Tit: "Tito",
  Flm: "Filemón", Stg: "Santiago", "1P": "1 Pedro", "2P": "2 Pedro",
  "1Jn": "1 Juan", "2Jn": "2 Juan", "3Jn": "3 Juan", Jud: "Judas",
  Ap: "Apocalipsis",
};

// Escapar caracteres regex en nombres de libros
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Construir alternation de libros ordenados por longitud desc
const sortedBooks = [...BOOKS].sort((a, b) => b.length - a.length);
const booksPattern = sortedBooks.map(escapeRegex).join("|");

// ─── Regex maestra ───────────────────────────────────────────────
// Captura: (libro) (capítulo):(versículo[-versículo])
// El versículo es opcional (puede citar solo un capítulo)
// Acepta "capítulo" y "versículo" literales como variantes

const SCRIPTURE_REGEX = new RegExp(
  [
    // Límite de palabra o inicio
    "(?<![\\wáéíóúÁÉÍÓÚñÑ])",
    // Grupo 1: nombre del libro (incluye prefijo numérico con espacio)
    `((?:[123]\\s)?(?:${booksPattern}))`,
    // Espacio opcional
    "\\s+",
    // "capítulo" opcional
    "(?:capítulo\\s+)?",
    // Grupo 2: capítulo (número)
    "(\\d{1,3})",
    // Opcional: :versículo o versículo-rango
    "(?:",
      "\\s*(?::|\\s|versículo\\s+)", // separador
      "(\\d{1,3})",                   // Grupo 3: versículo inicial
      "(?:-\\d{1,3})?",               // rango opcional
    ")?",
    // Límite: no seguido de letra (evita "Juan 3:16a" falso positivo parcial)
    "(?![\\wáéíóúÁÉÍÓÚñÑ])",
  ].join(""),
  "giu", // global, ignoreCase, unicode
);

interface ScriptureMatch {
  book: string;
  chapter: number;
  verse: number | null;
  start: number;
  end: number;
  raw: string;
}

function extractMatches(text: string): ScriptureMatch[] {
  const matches: ScriptureMatch[] = [];
  const regex = new RegExp(SCRIPTURE_REGEX.source, "giu");
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const rawBook = m[1]!.trim();
    const chapter = parseInt(m[2]!, 10);
    const verse = m[3] ? parseInt(m[3], 10) : null;

    // Normalizar nombre del libro
    const canonical = normalizeBook(rawBook);
    if (!canonical) continue;

    matches.push({
      book: canonical,
      chapter,
      verse,
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }

  return matches;
}

function normalizeBook(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");

  // Si ya es canónico (está en BOOKS sin ser abreviación)
  if (BOOKS.includes(trimmed as (typeof BOOKS)[number])) {
    // Normalizar "Salmos" → "Salmo"
    if (trimmed === "Salmos") return "Salmo";
    return trimmed;
  }

  // Probar abreviación
  if (ABBR_TO_CANONICAL[trimmed]) {
    return ABBR_TO_CANONICAL[trimmed];
  }

  return null;
}

function buildIdentifier(book: string, chapter: number, verse: number | null): string {
  return `scripture:${book.toLowerCase()}:${chapter}:${verse ?? "all"}`;
}

export class ScriptureParser implements ReferenceParser {
  readonly type = REFERENCE_TYPES.SCRIPTURE;

  parse(text: string): DetectedReference[] {
    const matches = extractMatches(text);
    return matches.map((m) => {
      const reference: Reference = {
        type: REFERENCE_TYPES.SCRIPTURE,
        publication: m.book,
        chapter: m.chapter,
        paragraph: m.verse,
        identifier: buildIdentifier(m.book, m.chapter, m.verse),
      };
      return {
        reference,
        start: m.start,
        end: m.end,
        raw: m.raw,
      };
    });
  }
}
