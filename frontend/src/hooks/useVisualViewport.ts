import { useEffect, useState } from "react";

/**
 * useVisualViewport — altura que le roba el teclado a la pantalla.
 *
 * En móvil, al enfocar el textarea el teclado tapa medio viewport pero
 * `100vh`/`100dvh` no se enteran: el composer queda debajo del teclado y hay
 * que hacer scroll a ciegas para ver lo que se escribe.
 *
 * Publica la variable CSS `--kb-inset` en `<html>` para que el composer se
 * suba y la lista de mensajes reserve ese hueco. Sin `visualViewport`
 * (Safari antiguo) queda a `0px` y todo se comporta como antes.
 */
export function useVisualViewport(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;

    const update = () => {
      const next = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Redondeado: el viewport visual da decimales y provocaría un repintado
      // por cada píxel de inercia del scroll.
      const rounded = Math.round(next);
      root.style.setProperty("--kb-inset", `${rounded}px`);
      setInset((prev) => (prev === rounded ? prev : rounded));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.setProperty("--kb-inset", "0px");
    };
  }, []);

  return inset;
}

/** ¿Está el teclado abierto? (para esconder la navegación inferior). */
export function useKeyboardOpen(): boolean {
  return useVisualViewport() > 120;
}
