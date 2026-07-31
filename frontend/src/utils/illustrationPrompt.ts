/**
 * Propuesta de descripción para ilustrar una respuesta.
 *
 * Se genera EN EL CLIENTE, sin llamar al modelo: proponer un prompt no puede
 * costar dinero ni tardar. Es un punto de partida editable, no una decisión.
 *
 * Regla de contenido: se parte del **hecho del mundo real** que la pieza usa
 * como gancho (el árbol, el faro, la guardia), nunca del pasaje bíblico. Es la
 * misma regla que siguen las ilustraciones del usuario, y encaja con la
 * salvaguarda que el backend añade siempre al prompt final.
 */

/** Frases que delatan que el párrafo habla del pasaje y no del mundo real. */
const BIBLICAL_HINTS = [
  "jehová",
  "jesús",
  "biblia",
  "bíblic",
  "versícul",
  "apóstol",
  "profeta",
  "discípul",
  "escritura",
  "atalaya",
  "congregac",
  "salmo",
  "capítulo",
];

/** Referencias, citas y adornos que no aportan nada a una descripción visual. */
function clean(text: string): string {
  return text
    .replace(/\(([^)]*\d[^)]*)\)/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/[\u00ab\u00bb\u201c\u201d"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksBiblical(sentence: string): boolean {
  const lowered = sentence.toLowerCase();
  return BIBLICAL_HINTS.some((hint) => lowered.includes(hint));
}

/**
 * Devuelve una descripción propuesta a partir del cuerpo de la respuesta.
 *
 * Estrategia: el título de la pieza (primer encabezado) da el tema, y la
 * primera frase larga que NO suene a pasaje da la escena concreta. Si no hay
 * ninguna, se cae a una descripción genérica y honesta: es un punto de
 * partida, y el usuario la va a editar de todos modos.
 */
export function proposeIllustrationPrompt(content: string): string {
  const heading = /^#{1,4}\s+(.+)$/m.exec(content || "");
  const title = heading ? clean(heading[1] ?? "") : "";

  const sentences = clean((content || "").replace(/^#{1,4}\s+.+$/gm, ""))
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 220);

  const scene = sentences.find((s) => !looksBiblical(s)) ?? "";

  if (scene) {
    return title ? `${scene} Tema: ${title}.` : scene;
  }
  if (title) {
    return `Una escena natural o cotidiana que ilustre la idea de «${title}».`;
  }
  return "Una escena natural que sirva de ilustración: un paisaje, un objeto o un fenómeno concreto.";
}

/** Nombre de archivo para la descarga: `study-ilustracion-<slug>-<fecha>`. */
export function imageFileName(prompt: string, mime: string): string {
  const slug =
    prompt
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ilustracion";
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return `study-ilustracion-${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
