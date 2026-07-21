import type { DetectedReference, Reference, ReferenceParser } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";

/**
 * FootnoteParser — detecta notas del autor y notas al pie.
 *
 * Cubre:
 *  - Notas numeradas entre corchetes: [1], [2], [nota 3]
 *  - "nota 1", "nota al pie 2", "nota del autor 5"
 *  - Superíndices simulados con asterisco: *, **, ***
 *  - Referencias tipo "véase nota 3"
 *
 * Normaliza a:
 *   publication = null (no aplica)
 *   chapter = null
 *   paragraph = número de nota
 *   identifier = "footnote:{numero}"
 */

// [1], [2], [nota 3], [nota del autor 5]
const BRACKET_NOTE_REGEX = /\[(?:nota(?:\s+(?:del\s+autor|al\s+pie))?\s*)?(\d{1,3})\]/giu;

// "nota 1", "nota al pie 2", "nota del autor 5" (sin corchetes)
const INLINE_NOTE_REGEX = /\bnota(?:\s+(?:del\s+autor|al\s+pie))?\s+(\d{1,3})\b/giu;

// Asteriscos: *, **, *** (hasta 3)
const ASTERISK_REGEX = /(\*{1,3})(?!\w)/gu;

const ASTERISK_TO_NUMBER: Record<string, number> = {
  "*": 1,
  "**": 2,
  "***": 3,
};

export class FootnoteParser implements ReferenceParser {
  readonly type = REFERENCE_TYPES.FOOTNOTE;

  parse(text: string): DetectedReference[] {
    const results: DetectedReference[] = [];

    // Notas entre corchetes
    let m: RegExpExecArray | null;
    const bracketRegex = new RegExp(BRACKET_NOTE_REGEX.source, "giu");
    while ((m = bracketRegex.exec(text)) !== null) {
      const num = parseInt(m[1]!, 10);
      results.push(this.buildDetected(num, m.index, m.index + m[0].length, m[0]));
    }

    // Notas inline
    const inlineRegex = new RegExp(INLINE_NOTE_REGEX.source, "giu");
    while ((m = inlineRegex.exec(text)) !== null) {
      const num = parseInt(m[1]!, 10);
      results.push(this.buildDetected(num, m.index, m.index + m[0].length, m[0]));
    }

    // Asteriscos
    const asteriskRegex = new RegExp(ASTERISK_REGEX.source, "gu");
    while ((m = asteriskRegex.exec(text)) !== null) {
      const stars = m[1]!;
      const num = ASTERISK_TO_NUMBER[stars];
      if (num !== undefined) {
        results.push(this.buildDetected(num, m.index, m.index + m[0].length, m[0]));
      }
    }

    // Deduplicar por posición (puede haber solapamiento entre patrones)
    return deduplicateByPosition(results);
  }

  private buildDetected(
    noteNumber: number,
    start: number,
    end: number,
    raw: string,
  ): DetectedReference {
    const reference: Reference = {
      type: REFERENCE_TYPES.FOOTNOTE,
      publication: null,
      chapter: null,
      paragraph: noteNumber,
      identifier: `footnote:${noteNumber}`,
    };
    return { reference, start, end, raw };
  }
}

function deduplicateByPosition(refs: DetectedReference[]): DetectedReference[] {
  const sorted = [...refs].sort((a, b) => a.start - b.start);
  const out: DetectedReference[] = [];
  let lastEnd = -1;
  for (const r of sorted) {
    if (r.start >= lastEnd) {
      out.push(r);
      lastEnd = r.end;
    }
  }
  return out;
}
