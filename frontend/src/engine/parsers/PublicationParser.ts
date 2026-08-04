import type { DetectedReference, Reference, ReferenceParser } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";

/**
 * PublicationParser — detecta referencias a publicaciones.
 *
 * Dos formas, porque el modelo escribe las dos:
 *
 *  1. **Cita legible**, que es la que pide el contrato de citas del prompt:
 *       "La Atalaya, 15 de mayo de 2015, pág. 12"
 *       "La Atalaya del 15 de mayo de 2015"
 *       "La Atalaya (estudio) julio de 2023, párr. 4"
 *       "¡Despertad! n.º 2 2018"
 *       "La Atalaya 2006"
 *  2. **Símbolo abreviado**, que es lo que devuelven las herramientas:
 *       "w15 15/5 pág. 20" · "g19 n.º 1" · "mwb24 abril"
 *
 * La versión anterior solo reconocía "Nombre + año", así que en
 * "(La Atalaya, 15 de mayo de 2015, pág. 12)" el chip cubría dos palabras y la
 * referencia se resolvía sin año ni página: la búsqueda que hace
 * `PublicationResolver` con eso no acierta. Ahora el chip abarca la cita
 * entera y el resolver recibe algo con lo que buscar.
 *
 * Normaliza a:
 *   publication = nombre o símbolo de la publicación
 *   chapter     = año (si se detecta)
 *   paragraph   = página o párrafo (si se detecta)
 *   identifier  = "publication:{nombre}:{año}:{página}"
 */

const PUBLICATION_NAMES = [
  "La Atalaya",
  "¡Despertad!",
  "Despertad",
  "Benefíciese de la Escuela del Ministerio Teocrático",
  "Guía de actividades",
  "Libro del Año",
  "Anuario",
  "Ministerio del Reino",
  "Nuestro Ministerio del Reino",
  "Vida y Ministerio",
  "Perspicacia",
  "Libro bíblico",
  "Folleto",
  "Libro",
] as const;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const namesPattern = PUBLICATION_NAMES
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join("|");

const monthsPattern = MONTHS.join("|");

/**
 * Cola opcional de una cita: la fecha y la localización dentro del número.
 *
 * Todo es opcional porque "La Atalaya 2006" es una cita válida y
 * "La Atalaya, 15 de mayo de 2015, pág. 12, párr. 4" también. Los grupos se
 * nombran para no depender del orden al leerlos.
 */
const TAIL = [
  // ", del 15 de mayo de" · " de mayo de" · " (estudio) "
  "(?:\\s*\\((?:estudio|lenguaje\\s+sencillo|p[úu]blica)\\))?",
  "(?:\\s*,)?",
  "(?:\\s+(?:del?|de))?",
  // Día. Solo cuenta como día si detrás viene "de <mes>": sin esa comprobación
  // el grupo se comía las dos primeras cifras del año y "La Atalaya 2006"
  // quedaba en "La Atalaya 20" sin año.
  `(?:\\s+(?<day>\\d{1,2})(?=\\s+de\\s+(?:${monthsPattern})))?`,
  "(?:\\s+de)?",
  // mes en letra
  `(?:\\s+(?<month>${monthsPattern}))?`,
  "(?:\\s+de)?",
  // número de edición: "n.º 2", "no. 2"
  "(?:\\s*,?\\s*n\\.?[ºo]?\\s*(?<edition>\\d{1,3}))?",
  // año
  "(?:\\s*,?\\s*(?<year>(?:19|20)\\d{2}))?",
  // página(s) y párrafo(s)
  "(?:\\s*,?\\s*p[áa]gs?\\.?\\s*(?<page>\\d{1,4})(?:\\s*[-–]\\s*\\d{1,4})?)?",
  "(?:\\s*,?\\s*p[áa]rrs?\\.?\\s*(?<par>\\d{1,3})(?:\\s*[-–,]\\s*\\d{1,3})?)?",
].join("");

/** "La Atalaya, 15 de mayo de 2015, pág. 12" */
const BY_NAME = new RegExp(
  `(?<![\\p{L}\\d])(?<name>${namesPattern})${TAIL}(?![\\p{L}])`,
  "giu",
);

/**
 * "w15 15/5 pág. 20" — símbolo + año en dos cifras.
 *
 * Se exige que haya ALGO detrás (fecha, página o párrafo) para no convertir en
 * chip cualquier palabra de dos letras seguida de dos dígitos que aparezca en
 * el texto. Un falso positivo aquí es un chip que no lleva a ninguna parte.
 */
const BY_SYMBOL = new RegExp(
  [
    "(?<![\\p{L}\\d])",
    "(?<symbol>[a-z]{1,4})(?<yy>\\d{2})",
    "(?=[\\s.,])",
    // día/mes ("15/5"), mes en letra, o directamente la página
    `(?:\\s+(?<date>\\d{1,2}/\\d{1,2}|${monthsPattern}))?`,
    "(?:\\s*,?\\s*p[áa]gs?\\.?\\s*(?<page>\\d{1,4})(?:\\s*[-–]\\s*\\d{1,4})?)?",
    "(?:\\s*,?\\s*p[áa]rrs?\\.?\\s*(?<par>\\d{1,3})(?:\\s*[-–,]\\s*\\d{1,3})?)?",
  ].join(""),
  "gu",
);

function toInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Expande el año de dos cifras de un símbolo ("w06" → 2006).
 *
 * Mismo criterio que el backend (`services/jw/pub_dates.py`): si cabe en este
 * siglo sin quedar en el futuro es de este siglo, y si no, del anterior.
 */
function expandYear(yy: string): number | null {
  const value = toInt(yy);
  if (value === null) return null;
  const now = new Date().getFullYear();
  const candidate = Math.floor(now / 100) * 100 + value;
  const year = candidate > now ? candidate - 100 : candidate;
  return year >= 1870 ? year : null;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_");
}

function build(
  name: string,
  year: number | null,
  location: number | null,
  raw: string,
  start: number,
): DetectedReference {
  const reference: Reference = {
    type: REFERENCE_TYPES.PUBLICATION,
    publication: name,
    chapter: year,
    paragraph: location,
    identifier: `publication:${slug(name)}:${year ?? "s.a."}:${location ?? "s.e."}`,
  };

  return { reference, start, end: start + raw.length, raw };
}

export class PublicationParser implements ReferenceParser {
  readonly type = REFERENCE_TYPES.PUBLICATION;

  parse(text: string): DetectedReference[] {
    const results: DetectedReference[] = [...byName(text), ...bySymbol(text)];

    // Los dos patrones pueden pisarse ("La Atalaya" y un "w15" dentro de la
    // misma cita). Gana el que empieza antes y, a igualdad, el más largo: es
    // el que cubre la cita entera.
    results.sort((a, b) => a.start - b.start || b.end - a.end);

    const kept: DetectedReference[] = [];
    let cursor = -1;
    for (const match of results) {
      if (match.start < cursor) continue;
      kept.push(match);
      cursor = match.end;
    }
    return kept;
  }
}

function byName(text: string): DetectedReference[] {
  const results: DetectedReference[] = [];
  const regex = new RegExp(BY_NAME.source, BY_NAME.flags);
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const g = m.groups ?? {};
    // El regex acaba en grupos opcionales, así que puede dejar espacios y
    // comas colgando al final ("La Atalaya, "). Sin recortarlos, el chip
    // se come la coma que separa de la frase siguiente.
    const raw = m[0].replace(/[\s,]+$/u, "");
    if (!raw) continue;

    results.push(
      build(
        g.name!.trim(),
        toInt(g.year),
        toInt(g.page) ?? toInt(g.par) ?? toInt(g.edition),
        raw,
        m.index,
      ),
    );

    // Los grupos opcionales permiten una coincidencia vacía; sin esto el
    // bucle no avanza y se cuelga la pestaña.
    if (m.index === regex.lastIndex) regex.lastIndex += 1;
  }

  return results;
}

function bySymbol(text: string): DetectedReference[] {
  const results: DetectedReference[] = [];
  const regex = new RegExp(BY_SYMBOL.source, BY_SYMBOL.flags);
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const g = m.groups ?? {};
    // Sin fecha ni página no hay cita: es una palabra con dos números detrás.
    if (!g.date && !g.page && !g.par) {
      if (m.index === regex.lastIndex) regex.lastIndex += 1;
      continue;
    }

    const raw = m[0].replace(/[\s,]+$/u, "");
    results.push(
      build(
        `${g.symbol}${g.yy}`,
        expandYear(g.yy!),
        toInt(g.page) ?? toInt(g.par),
        raw,
        m.index,
      ),
    );

    if (m.index === regex.lastIndex) regex.lastIndex += 1;
  }

  return results;
}
