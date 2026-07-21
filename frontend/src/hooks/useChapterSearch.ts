import { useMemo, useState, useCallback, useEffect } from "react";

interface UseChapterSearchOptions {
  /** Texto completo del capítulo o artículo a buscar */
  content: string;
  /** Ref al contenedor scrollable donde resaltar resultados */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface Match {
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
  content,
  containerRef,
}: UseChapterSearchOptions): UseChapterSearchReturn {
  const [query, setQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);

  const matches = useMemo<Match[]>(() => {
    if (!query.trim()) return [];
    const q = query.trim();
    const lower = content.toLowerCase();
    const ql = q.toLowerCase();
    const result: Match[] = [];
    let from = 0;
    while (true) {
      const idx = lower.indexOf(ql, from);
      if (idx === -1) break;
      result.push({
        index: idx,
        length: q.length,
        text: content.slice(idx, idx + q.length),
      });
      from = idx + q.length;
    }
    return result;
  }, [content, query]);

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
      // Buscar un elemento marcado con data-search-index
      const el = container.querySelector<HTMLElement>(
        `[data-search-index="${idx}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [containerRef, matches.length],
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
