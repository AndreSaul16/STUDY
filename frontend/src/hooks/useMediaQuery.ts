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
  /** Por debajo de esto la pantalla es "baja": móvil en apaisado. */
  SHORT_MAX: 480,
} as const;

/**
 * ¿Es móvil? Una columna con navegación inferior.
 *
 * No basta con el ancho: un teléfono en apaisado mide 844×390 y con la regla
 * de ancho caía en el split de escritorio, o sea 464px de chat y 380px de
 * panel sobre 390px de alto. La segunda condición (pantalla baja y no más
 * ancha que una tablet) lo devuelve al layout de una columna, que es el que
 * ese tamaño necesita.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(
    `(max-width: ${BREAKPOINTS.MOBILE_MAX}px), ` +
      `(max-height: ${BREAKPOINTS.SHORT_MAX}px) and (max-width: ${BREAKPOINTS.DESKTOP_MIN - 1}px)`,
  );
}

/** ¿Es escritorio holgado? (≥1150px) */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.DESKTOP_MIN}px)`);
}

/** ¿Pantalla baja? (≤480px de alto) — móvil en apaisado: cromo comprimido. */
export function useIsShort(): boolean {
  return useMediaQuery(`(max-height: ${BREAKPOINTS.SHORT_MAX}px)`);
}

/**
 * ¿Puntero grueso? Dedo, no ratón.
 *
 * El ancho no lo dice: una tablet de 1024px se maneja con el pulgar y un
 * portátil de 1024px con un ratón. Donde importa de verdad es en el composer:
 * con teclado en pantalla, Enter-envía manda medio mensaje constantemente.
 */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/** ¿Prefiere el usuario menos movimiento? Respetar es accesibilidad básica. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
