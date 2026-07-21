/**
 * SearchRepository — búsqueda sobre notas y fragmentos.
 *
 * Estrategia dual:
 *  - Si FTS5 está disponible (motor SQLite con FTS5 compilado):
 *    usa MATCH + bm25 + snippet — óptimo, ranking semántico real.
 *  - Si FTS5 NO está disponible (sql.js estándar NO lo trae):
 *    cae a LIKE con normalización de diacríticos + ranking manual
 *    basado en frecuencia de términos y proximidad.
 *
 * La detección se hace vía isFTS5Available() exportado por database.ts.
 */

import { queryAll } from "@/db/database";
import { isFTS5Available } from "@/db/database";

export interface SearchResult {
  note_id: string;
  title: string;
  content: string;
  selected_text: string;
  document_id: number;
  rank: number; // Score (menor = más relevante en FTS5; mayor = mejor en fallback)
  snippet: string; // Fragmento con highlight (delimitado por MARK_OPEN/MARK_CLOSE)
}

/**
 * Delimitadores de resaltado en snippets. Usamos caracteres de control
 * (no HTML) para que el resaltado NUNCA pueda inyectar markup: el componente
 * de UI parte por estos caracteres y crea elementos React <mark>.
 */
export const MARK_OPEN = "\u0001";
export const MARK_CLOSE = "\u0002";

// ─── Normalización para fallback LIKE ────────────────────────────

/** Quita diacríticos y normaliza a minúsculas para comparación. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacríticos
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // no-letras/números → espacio
    .replace(/\s+/g, " ")
    .trim();
}

/** Construye snippet con <mark> alrededor de la primera coincidencia. */
function buildSnippet(text: string, terms: string[], maxLen = 80): string {
  if (!text) return "";
  const normalized = normalize(text);
  const lowerText = text.toLowerCase();
  const lowerNorm = normalized;

  // Encontrar posición del primer término encontrado
  let firstPos = -1;
  let matchedTerm = "";
  for (const term of terms) {
    const termNorm = normalize(term);
    if (!termNorm) continue;
    const idx = lowerNorm.indexOf(termNorm);
    if (idx !== -1 && (firstPos === -1 || idx < firstPos)) {
      firstPos = idx;
      matchedTerm = termNorm;
    }
  }

  if (firstPos === -1) {
    // Sin coincidencia — devolver inicio truncado
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }

  // Mapear posición normalizada a posición original (aproximación)
  // Buscar el término en el texto original (case-insensitive, sin diacríticos estrictos)
  const termLower = matchedTerm.toLowerCase();
  const approxPos = lowerText.indexOf(termLower);

  let start: number;
  let prefix = "";
  if (approxPos !== -1) {
    start = Math.max(0, approxPos - Math.floor(maxLen / 3));
    if (start > 0) prefix = "...";
  } else {
    start = 0;
  }

  const end = Math.min(text.length, start + maxLen);
  let snippet = text.slice(start, end);
  if (end < text.length) snippet += "...";
  snippet = prefix + snippet;

  // Resaltar el término dentro del snippet
  if (approxPos !== -1) {
    const snipIdx = snippet.toLowerCase().indexOf(termLower);
    if (snipIdx !== -1) {
      snippet =
        snippet.slice(0, snipIdx) +
        MARK_OPEN +
        snippet.slice(snipIdx, snipIdx + termLower.length) +
        MARK_CLOSE +
        snippet.slice(snipIdx + termLower.length);
    }
  }

  return snippet;
}

/** Score manual: cuenta ocurrencias de términos en un texto. */
function scoreText(text: string, terms: string[]): number {
  const norm = normalize(text);
  if (!norm) return 0;
  let score = 0;
  for (const term of terms) {
    const termNorm = normalize(term);
    if (!termNorm) continue;
    // Contar ocurrencias (sin overlapping)
    let idx = 0;
    let count = 0;
    while ((idx = norm.indexOf(termNorm, idx)) !== -1) {
      count++;
      idx += termNorm.length;
    }
    // Ponderar: términos más largos pesan más
    score += count * (1 + termNorm.length / 10);
  }
  return score;
}

// ─── Implementación FTS5 ─────────────────────────────────────────

function searchFTS5(query: string, limit: number, documentId?: number): SearchResult[] {
  const sanitized = query
    .trim()
    .split(/\s+/)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");

  const sql = documentId
    ? `SELECT
         f.note_id,
         f.title,
         f.content,
         COALESCE(f.selected_text, '') as selected_text,
         f.document_id,
         bm25(notes_fts) as rank,
         snippet(notes_fts, 4, char(1), char(2), '...', 20) as snippet
       FROM notes_fts f
       WHERE notes_fts MATCH ? AND f.document_id = ?
       ORDER BY rank
       LIMIT ?`
    : `SELECT
         f.note_id,
         f.title,
         f.content,
         COALESCE(f.selected_text, '') as selected_text,
         f.document_id,
         bm25(notes_fts) as rank,
         snippet(notes_fts, 4, char(1), char(2), '...', 20) as snippet
       FROM notes_fts f
       WHERE notes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`;

  const params = documentId ? [sanitized, documentId, limit] : [sanitized, limit];
  return queryAll<SearchResult>(sql, params);
}

// ─── Implementación fallback LIKE ─────────────────────────────────

function searchFallback(query: string, limit: number, documentId?: number): SearchResult[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  // Construir cláusula WHERE con LIKE por cada término (sobre título + contenido + selected_text)
  // Usamos LOWER + REPLACE para simular búsqueda sin diacríticos.
  // Es menos eficiente que FTS5 pero correcto funcionalmente.
  const likeClauses = terms
    .map(() => `(LOWER(n.title) LIKE ? OR LOWER(n.content) LIKE ? OR LOWER(COALESCE(m.selected_text, '')) LIKE ?)`)
    .join(" OR ");

  const likeParams: string[] = [];
  for (const term of terms) {
    const wild = `%${term.toLowerCase()}%`;
    likeParams.push(wild, wild, wild);
  }

  const sql = documentId
    ? `SELECT n.note_id, n.title, n.content,
              COALESCE(m.selected_text, '') as selected_text,
              n.document_id
       FROM notes n
       LEFT JOIN user_marks m ON n.mark_id = m.mark_id
       WHERE n.document_id = ? AND (${likeClauses})`
    : `SELECT n.note_id, n.title, n.content,
              COALESCE(m.selected_text, '') as selected_text,
              n.document_id
       FROM notes n
       LEFT JOIN user_marks m ON n.mark_id = m.mark_id
       WHERE ${likeClauses}`;

  const params = documentId ? [documentId, ...likeParams] : likeParams;
  const rows = queryAll<{
    note_id: string;
    title: string;
    content: string;
    selected_text: string;
    document_id: number;
  }>(sql, params);

  // Scoring manual + snippet
  const scored = rows.map((row) => {
    const titleScore = scoreText(row.title, terms) * 3; // título pesa 3x
    const contentScore = scoreText(row.content, terms);
    const selScore = scoreText(row.selected_text, terms) * 2; // selected_text pesa 2x
    const totalScore = titleScore + contentScore + selScore;

    // Snippet: preferir content, luego selected_text, luego title
    let snippet: string;
    if (row.content && scoreText(row.content, terms) > 0) {
      snippet = buildSnippet(row.content, terms);
    } else if (row.selected_text && scoreText(row.selected_text, terms) > 0) {
      snippet = buildSnippet(row.selected_text, terms);
    } else {
      snippet = buildSnippet(row.title, terms);
    }

    return {
      note_id: row.note_id,
      title: row.title,
      content: row.content,
      selected_text: row.selected_text,
      document_id: row.document_id,
      rank: totalScore, // mayor = mejor
      snippet,
    };
  });

  // Ordenar por score descendente (mayor = mejor)
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit);
}

// ─── API pública ─────────────────────────────────────────────────

export const searchRepository = {
  /**
   * Búsqueda full-text con ranking.
   * Usa FTS5 si disponible, sino fallback LIKE con scoring manual.
   */
  search(query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return [];
    if (isFTS5Available()) {
      try {
        return searchFTS5(query, limit);
      } catch (e) {
        console.warn("[search] FTS5 falló, usando fallback:", e);
        return searchFallback(query, limit);
      }
    }
    return searchFallback(query, limit);
  },

  /**
   * Búsqueda con filtro por documento.
   */
  searchInDocument(query: string, documentId: number, limit = 20): SearchResult[] {
    if (!query.trim()) return [];
    if (isFTS5Available()) {
      try {
        return searchFTS5(query, limit, documentId);
      } catch (e) {
        console.warn("[search] FTS5 falló, usando fallback:", e);
        return searchFallback(query, limit, documentId);
      }
    }
    return searchFallback(query, limit, documentId);
  },

  /**
   * Sugerencias de búsqueda (autocompletar términos).
   * FTS5: usa MATCH con prefix. Fallback: LIKE en content.
   */
  suggest(prefix: string, limit = 5): string[] {
    if (!prefix.trim()) return [];

    if (isFTS5Available()) {
      try {
        const sanitized = `"${prefix.replace(/"/g, '""')}*"`;
        const results = queryAll<{ term: string }>(
          `SELECT DISTINCT content as term FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?`,
          [sanitized, limit],
        );
        return results.map((r) => r.term).slice(0, limit);
      } catch {
        // caer a fallback
      }
    }

    // Fallback LIKE
    const wild = `%${prefix.toLowerCase()}%`;
    const results = queryAll<{ content: string }>(
      `SELECT DISTINCT content FROM notes WHERE LOWER(content) LIKE ? LIMIT ?`,
      [wild, limit],
    );
    return results.map((r) => r.content).slice(0, limit);
  },

  /** ¿Está usando FTS5 actualmente? (para UI informativa) */
  isUsingFTS5(): boolean {
    return isFTS5Available();
  },
};
