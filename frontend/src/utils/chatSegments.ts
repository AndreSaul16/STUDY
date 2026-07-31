/**
 * chatSegments — parte la respuesta del asistente en trozos renderizables.
 *
 * Por qué: en los modos de redacción, la pieza que el usuario va a copiar y
 * pegar (el comentario de 30 segundos, la oración) llega en una cita de bloque
 * de Markdown. Si se pinta como un `blockquote` gris más, se pierde entre el
 * resto del texto y hay que seleccionarla con el dedo.
 *
 * Separándola podemos darle su propia tarjeta y su botón de copiar.
 */

export type ChatSegmentKind = "text" | "quote";

export interface ChatSegment {
  kind: ChatSegmentKind;
  /** Markdown del segmento, listo para renderizar. */
  markdown: string;
  /**
   * Texto plano del segmento sin la marca de cita ni las comillas envolventes.
   * Es lo que se copia al portapapeles.
   */
  plain: string;
}

/** ¿Esta línea es parte de una cita de bloque? */
function isQuoteLine(line: string): boolean {
  return /^\s{0,3}>/.test(line);
}

/** Quita el `>` inicial de una línea de cita. */
function stripQuoteMarker(line: string): string {
  return line.replace(/^\s{0,3}>\s?/, "");
}

/**
 * Quita las comillas que envuelven todo el bloque y el énfasis exterior.
 *
 * El modo comentario entrega el texto en negrita y entre comillas dobles.
 * Al pegarlo en las notas de la reunión no se quieren ni los asteriscos ni
 * las comillas: se quiere la frase.
 */
function unwrapQuoted(text: string): string {
  let out = text.trim();

  // **…** o *…* que envuelven el bloque entero.
  let changed = true;
  while (changed) {
    changed = false;
    const bold = /^\*\*([\s\S]+)\*\*$/.exec(out);
    if (bold) {
      out = (bold[1] ?? out).trim();
      changed = true;
      continue;
    }
    const italic = /^[*_]([\s\S]+)[*_]$/.exec(out);
    if (italic) {
      out = (italic[1] ?? out).trim();
      changed = true;
    }
  }

  // Comillas rectas, tipográficas y españolas.
  const quoted = /^["“«]([\s\S]+)["”»]$/.exec(out);
  if (quoted) out = (quoted[1] ?? out).trim();

  return out;
}

/**
 * Divide el markdown en segmentos de texto y de cita.
 *
 * Las vallas de código se respetan: un `>` dentro de un bloque ``` no abre una
 * cita.
 */
export function splitChatSegments(markdown: string): ChatSegment[] {
  const source = markdown ?? "";
  if (!source.trim()) return [];

  const lines = source.split("\n");
  const segments: ChatSegment[] = [];

  let buffer: string[] = [];
  let inQuote = false;
  let inFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const raw = buffer.join("\n");
    if (!raw.trim()) {
      buffer = [];
      return;
    }

    if (inQuote) {
      const inner = buffer.map(stripQuoteMarker).join("\n").trim();
      segments.push({
        kind: "quote",
        markdown: inner,
        plain: unwrapQuoted(inner),
      });
    } else {
      segments.push({ kind: "text", markdown: raw.trim(), plain: raw.trim() });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }

    if (inFence) {
      buffer.push(line);
      continue;
    }

    const quoteLine = isQuoteLine(line);
    if (quoteLine !== inQuote) {
      flush();
      inQuote = quoteLine;
    }
    buffer.push(line);
  }

  flush();
  return segments;
}
