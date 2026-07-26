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

/**
 * Breakpoints de la app. Tres, no dos:
 *
 *   móvil    <768px   una columna; la investigación vive en un bottom sheet
 *   tablet   768-1149 split, pero el lector manda (65/35) y el panel es estrecho
 *   escritorio ≥1150  split holgado (60/40) con el panel completo
 *
 * La franja de tablet existía sin querer: a 800px se aplicaba el split de
 * escritorio y el panel derecho quedaba en ~320px, con las pestañas y la
 * rejilla de capítulos apretadas.
 */
export const BREAKPOINTS = {
  MOBILE_MAX: 767,
  DESKTOP_MIN: 1150,
} as const;

/** ¿Es móvil? (<768px) — sin split, con navegación inferior. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.MOBILE_MAX}px)`);
}

/** ¿Es escritorio holgado? (≥1150px) */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.DESKTOP_MIN}px)`);
}

/** ¿Prefiere el usuario menos movimiento? Respetar es accesibilidad básica. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
