/**
 * localLibrarySearch — recuperación en el CLIENTE sobre la biblioteca .jwpub.
 *
 * POR QUÉ ESTO VIVE AQUÍ Y NO EN EL BACKEND
 *
 * Las publicaciones del usuario están en IndexedDB (ver libraryCache.ts): son
 * suyas, sobreviven a un redespliegue y el backend nunca las almacena. Pero el
 * agente del chat corre en el servidor, así que NO puede verlas. La única forma
 * de que responda basándose en ellas sin romper esa decisión es partir el
 * trabajo: **la búsqueda se hace en el navegador y solo viajan los fragmentos**.
 *
 * La alternativa —volver a subir la publicación entera en cada turno— serían
 * megas por pregunta y devolvería al servidor el papel de almacén que
 * deliberadamente se le quitó.
 *
 * Esto NO es un buscador semántico y no pretende serlo: no hay embeddings ni
 * índice invertido en el navegador. Es coincidencia de términos con puntuación
 * por cobertura, que para "¿qué dice mi libro sobre el aguante?" acierta de
 * sobra y cuesta un puñado de milisegundos.
 */

import { getPublication, type StoredPublication } from "@/services/libraryCache";

/**
 * Topes. Son un PRESUPUESTO, no una optimización.
 *
 * Todo lo que sale de aquí se mete en el prompt y viaja al proveedor de IA en
 * CADA turno que use la biblioteca. Sin topes, marcar un libro de 800 páginas
 * significaría pagar (y esperar) por él una y otra vez.
 *
 *  - `maxSnippets` 6: por encima de media docena el modelo empieza a repetir
 *    fuentes en vez de profundizar, y la respuesta se vuelve un resumen.
 *  - `maxSnippetChars` 700: unos dos párrafos. Es lo mínimo para que un
 *    fragmento se entienda solo; menos obliga al modelo a adivinar el contexto.
 *  - `maxTotalChars` 3500: ~900 tokens en español. Es el tope que MANDA: con
 *    fragmentos largos deja pasar cinco, con cortos los seis. El peor caso
 *    teórico (6 × 700 = 4200) no llega a ocurrir nunca, y así el coste por
 *    turno es predecible mires el libro que mires.
 *  - `maxPerPublication` 3: si marcas dos libros, los dos tienen voz. Sin este
 *    tope, un libro largo y repetitivo se lleva los seis huecos.
 *  - `maxTerms` 8: una pregunta larga no puede convertir la búsqueda en un
 *    barrido de veinte expresiones regulares por documento.
 */
export const LOCAL_SEARCH_LIMITS = {
  maxSnippets: 6,
  maxSnippetChars: 700,
  maxTotalChars: 3500,
  maxPerPublication: 3,
  maxTerms: 8,
} as const;

/**
 * Cada cuántos caracteres de HTML se le devuelve el turno al navegador.
 *
 * Medido en Chromium sobre una biblioteca sintética de 4,5 MB (300 documentos
 * de ~15 KB): el barrido completo tarda ~120 ms. Sin cortarlo son 120 ms de
 * hilo principal bloqueado justo cuando el usuario acaba de pulsar Enviar —
 * suficiente para que la animación del composer dé un tirón visible. Con
 * cortes cada 400 KB son ~11 trozos de ~11 ms, por debajo del frame de 16 ms.
 *
 * No se usa un Worker: habría que copiar los megas de HTML al worker (structured
 * clone) y esa copia cuesta más que el propio barrido.
 */
const YIELD_EVERY_CHARS = 400_000;

/** Un fragmento encontrado, listo para acompañar a la pregunta. */
export interface LocalSnippet {
  /** Símbolo de la publicación, ej. "bt". Es lo que la identifica. */
  symbol: string;
  /** Título legible de la publicación, para que el modelo pueda citarla. */
  publication: string;
  documentId: number;
  documentTitle: string;
  text: string;
}

/** Forma de cable hacia el backend: snake_case, como el resto del contrato. */
export interface LocalSnippetWire {
  symbol: string;
  publication: string;
  document_id: number;
  document_title: string;
  text: string;
}

export function toWire(snippets: LocalSnippet[]): LocalSnippetWire[] {
  return snippets.map((s) => ({
    symbol: s.symbol,
    publication: s.publication,
    document_id: s.documentId,
    document_title: s.documentTitle,
    text: s.text,
  }));
}

// ─── Normalización ───────────────────────────────────────────────

/**
 * Mapa de plegado de acentos, carácter a carácter.
 *
 * A propósito NO se usa `normalize("NFD")`: descomponer cambia la longitud de
 * la cadena y los índices dejarían de servir para recortar el extracto sobre el
 * texto ORIGINAL (con sus acentos, que es el que lee el modelo). Este mapa es
 * 1:1, así que la posición de una coincidencia en el texto plegado es la misma
 * que en el original.
 */
const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ñ: "n", ç: "c",
};

/** Minúsculas y sin acentos. "Aguante" y "aguanté" tienen que coincidir. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[áàâäãéèêëíìîïóòôöõúùûüñç]/g, (c) => FOLD[c] ?? c);
}

/**
 * Palabras vacías del español.
 *
 * Sin esto, "¿qué dice sobre el aguante?" puntuaría igual de alto cualquier
 * documento que contenga "que", "dice" y "el" — es decir, todos.
 */
const STOPWORDS = new Set([
  "para", "por", "que", "con", "los", "las", "del", "una", "uno", "unos",
  "unas", "sobre", "como", "pero", "sus", "mas", "muy", "son", "fue", "han",
  "hay", "eso", "esa", "ese", "esta", "este", "estos", "estas", "esos", "esas",
  "aqui", "alli", "cuando", "donde", "quien", "quienes", "cual", "cuales",
  "porque", "segun", "entre", "hasta", "desde", "sin", "ser", "estar", "tener",
  "hacer", "puede", "pueden", "debe", "deben", "todo", "toda", "todos", "todas",
  "nos", "les", "mi", "tu", "su", "yo", "el", "la", "lo", "de", "en", "un",
  "dice", "decir", "significa", "explica", "explicame", "cuentame", "dime",
  "cita", "texto", "parrafo", "capitulo", "libro", "publicacion",
]);

/**
 * Los términos con los que se busca de verdad.
 *
 * Un `includes()` de la frase entera no sirve: nadie escribe en su libro la
 * misma frase con la que preguntas. Se parte en términos, se tiran las
 * palabras vacías y se puntúa por cuántos términos DISTINTOS aparecen, que es
 * lo que separa un documento sobre el tema de uno que lo menciona de pasada.
 */
export function queryTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const raw of fold(query).split(/[^a-z0-9]+/)) {
    // Los números de dos cifras se conservan: "Isaías 58" y "1914" son
    // términos de búsqueda buenísimos y el filtro de longitud se los comía.
    const useful = raw.length >= 4 || (raw.length >= 2 && /^\d+$/.test(raw));
    if (!useful || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
    if (terms.length >= LOCAL_SEARCH_LIMITS.maxTerms) break;
  }

  return terms;
}

/**
 * HTML del .jwpub → texto plano.
 *
 * `Content` es HTML con clases, `<span>` de números de párrafo y marcado de
 * referencias. Buscar sobre él daría falsos positivos en los atributos y
 * mandaría al modelo un extracto lleno de etiquetas.
 *
 * Con expresiones regulares y no con `DOMParser`: se llama una vez por
 * documento (cientos por publicación) y construir un DOM completo para tirarlo
 * acto seguido cuesta un orden de magnitud más. La contrapartida conocida es
 * que un atributo que contenga `>` sin escapar cortaría mal; en el HTML que
 * genera el .jwpub no ocurre.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Un término = una expresión regular anclada solo por delante.
 *
 * El ancla de inicio (`\b`) evita que "dio" case dentro de "estudio". La de
 * final se omite a propósito: así "constancia" encuentra "constancias" y
 * "aguante" encuentra "aguantes", que es un lematizado pobre pero gratis y
 * suficiente para el español.
 *
 * Se compilan UNA vez por búsqueda y se reutilizan en todos los documentos;
 * `lastIndex` se resetea antes de cada uso porque llevan la bandera `g`.
 */
function compileMatchers(terms: string[]): RegExp[] {
  return terms.map((t) => new RegExp(`\\b${escapeRegExp(t)}`, "g"));
}

interface DocumentHit {
  /** Términos DISTINTOS encontrados. Es la señal principal. */
  matched: number;
  /** Términos que además aparecen en el título: pesan más que en el cuerpo. */
  inTitle: number;
  /** Posición de la primera coincidencia, para centrar el extracto. */
  at: number;
}

function scoreDocument(
  foldedText: string,
  foldedTitle: string,
  matchers: RegExp[],
): DocumentHit | null {
  let matched = 0;
  let inTitle = 0;
  let at = -1;

  for (const matcher of matchers) {
    matcher.lastIndex = 0;
    const found = matcher.exec(foldedText);
    if (found) {
      matched += 1;
      if (at === -1 || found.index < at) at = found.index;
    }
    matcher.lastIndex = 0;
    if (matcher.test(foldedTitle)) inTitle += 1;
  }

  if (matched === 0) return null;
  return { matched, inTitle, at: at === -1 ? 0 : at };
}

/**
 * Extracto centrado en la coincidencia, cortado por espacios.
 *
 * Centrado y no desde el principio del documento: el término suele estar en la
 * página 40 de un capítulo, y mandar el arranque del capítulo sería mandar algo
 * que no contesta a nada. Los cortes se ajustan al espacio más cercano para no
 * empezar ni acabar a mitad de palabra, y se marcan con "…" para que el modelo
 * sepa que hay texto antes y después y no lo lea como una cita cerrada.
 */
export function extractSnippet(text: string, at: number): string {
  const max = LOCAL_SEARCH_LIMITS.maxSnippetChars;
  if (text.length <= max) return text;

  let start = Math.max(0, Math.min(at - Math.floor(max / 2), text.length - max));
  let end = start + max;

  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space - start < 40) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start) end = space;
  }

  const cut = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${cut}${end < text.length ? "…" : ""}`;
}

/** Le devuelve el turno al navegador para que pueda pintar un frame. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Candidate extends LocalSnippet {
  hit: DocumentHit;
}

/** Más términos distintos primero; a igualdad, el que los tiene en el título. */
function byRelevance(a: Candidate, b: Candidate): number {
  if (a.hit.matched !== b.hit.matched) return b.hit.matched - a.hit.matched;
  if (a.hit.inTitle !== b.hit.inTitle) return b.hit.inTitle - a.hit.inTitle;
  return a.hit.at - b.hit.at;
}

/**
 * Busca en publicaciones YA cargadas en memoria.
 *
 * Separada de `searchLocalLibrary` para poder probarla sin IndexedDB: recibe
 * los datos, devuelve los fragmentos y no toca nada más.
 */
export async function searchPublications(
  query: string,
  publications: StoredPublication[],
): Promise<LocalSnippet[]> {
  const terms = queryTerms(query);
  if (terms.length === 0 || publications.length === 0) return [];

  const matchers = compileMatchers(terms);
  const candidates: Candidate[] = [];
  let scanned = 0;

  for (const stored of publications) {
    if (!stored) continue;
    const perPublication: Candidate[] = [];

    for (const doc of stored.documents ?? []) {
      const html = typeof doc?.Content === "string" ? doc.Content : "";
      if (!html) continue;

      scanned += html.length;
      if (scanned >= YIELD_EVERY_CHARS) {
        scanned = 0;
        await yieldToUi();
      }

      const text = stripHtml(html);
      if (!text) continue;

      const title = typeof doc.Title === "string" ? doc.Title : "";
      const hit = scoreDocument(fold(text), fold(title), matchers);
      if (!hit) continue;

      perPublication.push({
        symbol: stored.symbol,
        publication: stored.publication?.title || stored.symbol,
        documentId: Number(doc.DocumentId) || 0,
        documentTitle: title || "Sin título",
        text: extractSnippet(text, hit.at),
        hit,
      });
    }

    perPublication.sort(byRelevance);
    candidates.push(...perPublication.slice(0, LOCAL_SEARCH_LIMITS.maxPerPublication));
  }

  candidates.sort(byRelevance);

  // El corte por volumen va DESPUÉS de ordenar: si hay que dejar algo fuera,
  // que sea lo menos relevante y no lo que tocara por orden de biblioteca.
  const chosen: LocalSnippet[] = [];
  let total = 0;
  for (const candidate of candidates) {
    if (chosen.length >= LOCAL_SEARCH_LIMITS.maxSnippets) break;
    if (total + candidate.text.length > LOCAL_SEARCH_LIMITS.maxTotalChars) break;
    total += candidate.text.length;
    const { hit: _hit, ...snippet } = candidate;
    chosen.push(snippet);
  }

  return chosen;
}

/**
 * Busca en los libros que el usuario haya marcado en Ajustes.
 *
 * NUNCA lanza y NUNCA usa `listPublications()`: se piden solo los símbolos
 * marcados, porque cargar la biblioteca entera desde IndexedDB para descartar
 * la mitad serían megas leídos para nada. Un símbolo que ya no existe (el libro
 * se borró y el ajuste se quedó) simplemente no aporta fragmentos.
 */
export async function searchLocalLibrary(
  query: string,
  symbols: string[],
): Promise<LocalSnippet[]> {
  if (symbols.length === 0) return [];

  try {
    const stored = await Promise.all(symbols.map((s) => getPublication(s)));
    const found = stored.filter((p): p is StoredPublication => p !== null);
    return await searchPublications(query, found);
  } catch (error) {
    console.warn("[biblioteca] la búsqueda local falló:", error);
    return [];
  }
}
