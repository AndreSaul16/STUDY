import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useStickToBottom — auto-scroll que NO secuestra al usuario.
 *
 * El chat hacía `scrollTop = scrollHeight` en cada token recibido. Mientras la
 * IA escribe (30-60 s) era imposible releer hacia arriba: cada token te devolvía
 * al final. En móvil, insufrible.
 *
 * Aquí el efecto solo actúa si el usuario YA estaba abajo. Si sube, se queda
 * donde está y la pantalla ofrece un botón para volver al final.
 */

/** A menos de esto del fondo se considera que el usuario "está abajo". */
const BOTTOM_THRESHOLD_PX = 96;

interface UseStickToBottomReturn {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** ¿El usuario está pegado al fondo? Si no, hay contenido nuevo sin ver. */
  atBottom: boolean;
  scrollToBottom: (options?: ScrollToOptions) => void;
  /** Handler para el onScroll del contenedor. */
  onScroll: () => void;
}

export function useStickToBottom(deps: unknown[]): UseStickToBottomReturn {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Ref además del estado: el efecto necesita el valor actual sin volver a
  // suscribirse en cada cambio.
  const atBottomRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = distance < BOTTOM_THRESHOLD_PX;
    atBottomRef.current = next;
    setAtBottom((prev) => (prev === next ? prev : next));
  }, []);

  const scrollToBottom = useCallback((options?: ScrollToOptions) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, ...options });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { scrollRef, atBottom, scrollToBottom, onScroll };
}
