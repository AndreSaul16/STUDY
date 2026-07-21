import { useMemo, useState, useCallback, useEffect } from "react";

interface ChapterBlock {
  blockId: number;
  content: string;
}

interface UseChapterSearchOptions {
  /** Bloques del capítulo/artículo a buscar */
  blocks: ChapterBlock[];
  /** Ref al contenedor scrollable donde resaltar resultados */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface Match {
  /** Bloque donde ocurre el match (para scroll via data-block-id) */
  blockId: number;
  /** Offset dentro del content del bloque */
  index: number;
  length: number;
  /** Texto del match */
  text: string;
}

interface UseChapterSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  matches: Match[];
  currentMatch: number;
  /** Índice del match activo (1-based para UI) */
  currentLabel: string;
  goToNext: () => void;
  goToPrev: () => void;
  clear: () => void;
}

/**
 * useChapterSearch — búsqueda interna tipo Ctrl+F.
 * Encuentra matches en el contenido, permite navegar entre ellos
 * y scrolla al match activo.
 */
export function useChapterSearch({
  blocks,
  containerRef,
}: UseChapterSearchOptions): UseChapterSearchReturn {
  const [query, setQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);

  const matches = useMemo<Match[]>(() => {
    if (!query.trim()) return [];
    const q = query.trim();
    const ql = q.toLowerCase();
    const result: Match[] = [];
    for (const block of blocks) {
      const lower = block.content.toLowerCase();
      let from = 0;
      while (true) {
        const idx = lower.indexOf(ql, from);
        if (idx === -1) break;
        result.push({
          blockId: block.blockId,
          index: idx,
          length: q.length,
          text: block.content.slice(idx, idx + q.length),
        });
        from = idx + q.length;
      }
    }
    return result;
  }, [blocks, query]);

  // Reset cursor al cambiar query
  useEffect(() => {
    setCurrentMatch(matches.length > 0 ? 0 : -1);
  }, [matches.length]);

  // Clamp currentMatch si queda fuera de rango (ej: contenido cambió tras reflow)
  useEffect(() => {
    if (matches.length > 0 && (currentMatch < 0 || currentMatch >= matches.length)) {
      setCurrentMatch(0);
    }
  }, [matches.length, currentMatch]);

  const scrollToMatch = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= matches.length) return;
      const container = containerRef.current;
      if (!container) return;
      // Scroll al bloque que contiene el match (via data-block-id que renderiza BlockRenderer)
      const match = matches[idx];
      if (!match) return;
      const el = container.querySelector<HTMLElement>(
        `[data-block-id="${match.blockId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [containerRef, matches],
  );

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (currentMatch + 1) % matches.length;
    setCurrentMatch(next);
    scrollToMatch(next);
  }, [currentMatch, matches.length, scrollToMatch]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (currentMatch - 1 + matches.length) % matches.length;
    setCurrentMatch(prev);
    scrollToMatch(prev);
  }, [currentMatch, matches.length, scrollToMatch]);

  const clear = useCallback(() => {
    setQuery("");
    setCurrentMatch(-1);
  }, []);

  const currentLabel =
    matches.length > 0
      ? `${currentMatch + 1} de ${matches.length}`
      : query.trim()
        ? "0 resultados"
        : "";

  return {
    query,
    setQuery,
    matches,
    currentMatch,
    currentLabel,
    goToNext,
    goToPrev,
    clear,
  };
}
