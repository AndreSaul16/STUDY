import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { IconClose, IconGrip } from "@/components/atoms/Icons";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";

/**
 * BottomSheet — panel de investigación en móvil.
 *
 * Se puede arrastrar por el asa: bajar lo cierra, subir lo lleva a pantalla
 * casi completa. Es el gesto que la gente ya espera de una hoja inferior, y
 * aquí importa porque el chat y el buscador se usan largo rato y 85 % de alto
 * fijo se queda corto en cuanto sale el teclado.
 *
 * Sólo se arrastra desde el asa, no desde el cuerpo: si no, el gesto pelearía
 * con el scroll de la lista de resultados.
 */

/** Altura de reposo, como fracción del alto de la ventana. */
const REST_HEIGHT = 0.85;
/** Arrastre hacia abajo, en px, a partir del cual se cierra al soltar. */
const CLOSE_THRESHOLD = 120;
/**
 * Alto de la barra de navegación inferior, que queda por encima de la hoja.
 * Sale de `--nav-h` (index.css) porque en apaisado la barra se comprime.
 */
const NAV_HEIGHT = "var(--nav-h)";

export function BottomSheet() {
  const open = useUIStore((s) => s.mobileSheetOpen);
  const setOpen = useUIStore((s) => s.setMobileSheetOpen);
  const reducedMotion = usePrefersReducedMotion();

  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  // Bloquear el scroll del fondo mientras la hoja está abierta.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Esc cierra, como cualquier diálogo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Al cerrar, olvidar el arrastre para que la próxima apertura salga limpia.
  useEffect(() => {
    if (!open) {
      setDragOffset(0);
      setDragging(false);
    }
  }, [open]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startYRef.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const delta = e.clientY - startYRef.current;
      // Arriba se puede estirar un poco (con resistencia); abajo, libre.
      setDragOffset(delta < 0 ? Math.max(delta, -80) / 2 : delta);
    },
    [dragging],
  );

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (dragOffset > CLOSE_THRESHOLD) {
      setOpen(false);
      return;
    }
    setDragOffset(0);
  }, [dragging, dragOffset, setOpen]);

  if (!open) return null;

  return (
    // Sin `md:hidden`, por lo mismo que BottomNav: en apaisado el layout es de
    // una columna aunque la pantalla mida 844px de ancho, y la hoja es la
    // única forma de llegar al panel de investigación.
    <div className="fixed inset-0 z-[110]">
      <div
        className="absolute inset-0 bg-ink-400/40 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Panel de investigación"
        style={{
          // Se apoya justo encima de la barra de navegación, que permanece
          // visible y pulsable mientras la hoja está abierta.
          bottom: NAV_HEIGHT,
          height: `calc(${REST_HEIGHT * 100}dvh - ${NAV_HEIGHT})`,
          transform: `translateY(${Math.max(dragOffset, 0)}px)`,
          // Durante el arrastre no hay transición: el panel debe seguir al dedo.
          transition: dragging ? "none" : "transform 0.28s var(--ease-out-expo)",
        }}
        className={cn(
          "absolute inset-x-0",
          "rounded-t-2xl",
          "bg-paper-50 dark:bg-ink-100",
          "shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.3)]",
          !reducedMotion && !dragging && "animate-sheet-up",
          "flex flex-col overflow-hidden",
        )}
      >
        {/* Asa de arrastre */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            "relative flex shrink-0 items-center justify-center",
            "h-11 cursor-grab touch-none active:cursor-grabbing",
          )}
        >
          <IconGrip
            width={24}
            height={24}
            className="text-muted-light dark:text-muted-dark"
          />
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar panel"
            className={cn(
              // 44px: la hoja es táctil por definición y el asa de arrastre
              // ocupa el centro, así que fallar el cierre obliga a arrastrar.
              "absolute right-1 top-0 flex h-11 w-11 items-center justify-center rounded-full",
              "text-muted-light hover:bg-paper-200",
              "dark:text-muted-dark dark:hover:bg-ink-50",
            )}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ResearchPanel className="h-full" />
        </div>
      </div>
    </div>
  );
}
