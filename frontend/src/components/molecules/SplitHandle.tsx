import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

interface SplitHandleProps {
  /** Ancho actual del panel DERECHO, en % del contenedor. */
  value: number;
  onChange: (percent: number) => void;
  min: number;
  max: number;
  label?: string;
}

/**
 * SplitHandle — la costura arrastrable entre el chat y el panel derecho.
 *
 * Tres decisiones que no son cosméticas:
 *
 * 1. **La zona sensible es más ancha que la línea.** La costura se ve como 1px
 *    porque visualmente tiene que ser una costura, pero se agarra en 9px. Un
 *    objetivo de arrastre de un píxel es inusable con ratón y directamente
 *    imposible con trackpad.
 * 2. **Se usan Pointer Events y captura.** Con `mousemove` sobre el propio
 *    div, el puntero se escapa del elemento en cuanto arrastras rápido y el
 *    arrastre se queda colgado a mitad. `setPointerCapture` lo evita.
 * 3. **También funciona con el teclado.** Es un `separator` con rol ARIA y
 *    responde a las flechas: quien no pueda arrastrar tiene que poder
 *    repartir el espacio igualmente.
 */
export function SplitHandle({
  value,
  onChange,
  min,
  max,
  label = "Ajustar el ancho del panel",
}: SplitHandleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const percentFromEvent = useCallback((clientX: number) => {
    const parent = ref.current?.parentElement;
    if (!parent) return null;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0) return null;
    // El panel es el de la DERECHA: su ancho es lo que queda del puntero al
    // borde derecho del contenedor.
    return ((rect.right - clientX) / rect.width) * 100;
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    ref.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const percent = percentFromEvent(event.clientX);
    if (percent !== null) onChange(percent);
  };

  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    ref.current?.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  // Mientras se arrastra, el cursor y la no-selección se ponen en el <body>:
  // si solo estuvieran en el handle, al salirse el puntero (que se sale, por
  // eso hay captura) el cursor volvería a la flecha y se seleccionaría el
  // texto del chat de fondo.
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const previo = { cursor: style.cursor, select: style.userSelect };
    style.cursor = "col-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = previo.cursor;
      style.userSelect = previo.select;
    };
  }, [dragging]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const paso = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(value + paso); // izquierda = el panel derecho crece
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange(value - paso);
    }
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange((min + max) / 2)}
      className={cn(
        "group relative h-full w-[9px] shrink-0 cursor-col-resize touch-none",
        "focus-visible:outline-none",
      )}
    >
      {/* La costura visible: 1px centrado dentro de la zona de agarre. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          "transition-colors duration-150",
          dragging
            ? "bg-amber-600 dark:bg-amber-500"
            : "bg-seam-light group-hover:bg-amber-600/60 group-focus-visible:bg-amber-600 dark:bg-seam-dark dark:group-hover:bg-amber-500/60",
        )}
      />
    </div>
  );
}
