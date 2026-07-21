import { useRef, useEffect, useState, useCallback } from "react";

interface UseVirtualListOptions {
  /** Número total de items */
  itemCount: number;
  /** Altura estimada de cada item en px */
  estimateSize: number;
  /**
   * Altura del contenedor viewport en px.
   * Si se omite, se mide automáticamente via ResizeObserver.
   */
  containerHeight?: number;
  /** Overscan: items extra renderizados fuera del viewport */
  overscan?: number;
}

interface UseVirtualListReturn {
  /** Índice del primer item visible */
  startIndex: number;
  /** Índice del último item visible (exclusivo) */
  endIndex: number;
  /** Lista de items virtuales con su offset */
  virtualItems: Array<{ index: number; offsetTop: number }>;
  /** Scroll total height */
  totalHeight: number;
  /** Ref al contenedor scrollable */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Scroll al item dado */
  scrollToIndex: (index: number) => void;
}

/**
 * useVirtualList — virtualización minimalista sin dependencias.
 *
 * Para listas de notas/marcas que pueden crecer a miles de items.
 * Solo renderiza los items visibles + overscan.
 *
 * Si `containerHeight` se omite, usa ResizeObserver para medir
 * la altura real del contenedor y reaccionar a cambios de layout.
 */
export function useVirtualList({
  itemCount,
  estimateSize,
  containerHeight,
  overscan = 3,
}: UseVirtualListOptions): UseVirtualListReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(containerHeight ?? 0);

  // Si se pasa containerHeight por prop, usarla; si no, medir con ResizeObserver
  const effectiveHeight = containerHeight ?? measuredHeight;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Medir altura real del contenedor si no se pasó por prop
  useEffect(() => {
    if (containerHeight !== undefined) return; // Prop explícita → no medir
    const el = containerRef.current;
    if (!el) return;

    // Medición inicial
    setMeasuredHeight(el.clientHeight);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0 && h !== measuredHeight) {
          setMeasuredHeight(h);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerHeight, measuredHeight]);

  const totalHeight = itemCount * estimateSize;

  // Si effectiveHeight es 0 (aún no medido), renderizar overscan mínimo
  const safeHeight = effectiveHeight > 0 ? effectiveHeight : estimateSize * 4;

  const startIndex = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
  const visibleCount = Math.ceil(safeHeight / estimateSize) + overscan * 2;
  const endIndex = Math.min(itemCount, startIndex + visibleCount);

  const virtualItems: Array<{ index: number; offsetTop: number }> = [];
  for (let i = startIndex; i < endIndex; i++) {
    virtualItems.push({
      index: i,
      offsetTop: i * estimateSize,
    });
  }

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: index * estimateSize, behavior: "smooth" });
    },
    [estimateSize],
  );

  return {
    startIndex,
    endIndex,
    virtualItems,
    totalHeight,
    containerRef,
    scrollToIndex,
  };
}
