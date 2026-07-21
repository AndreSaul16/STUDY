import { useEffect, useState } from "react";

/**
 * Media query hook — para responsive behavior sin librerías.
 * Usa matchMedia con SSR-safe fallback.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Shortcut: ¿es móvil? (≤ 768px) */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
