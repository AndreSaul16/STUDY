import { useEffect, useRef } from "react";
import type { SelectionRange, HighlightColor } from "@/types/domain";
import { HIGHLIGHT_COLORS } from "@/types/domain";
import { cn } from "@/utils/cn";
import { IconClose, IconNote } from "@/components/atoms/Icons";

interface ContextMenuProps {
  selection: SelectionRange;
  onClose: () => void;
  onHighlight: (color: HighlightColor) => void;
  onAddNote: () => void;
}

const SWATCHES: { color: HighlightColor; label: string; bg: string }[] = [
  { color: HIGHLIGHT_COLORS.YELLOW, label: "Ámbar", bg: "bg-mark-yellow" },
  { color: HIGHLIGHT_COLORS.GREEN, label: "Verde", bg: "bg-mark-green" },
  { color: HIGHLIGHT_COLORS.BLUE, label: "Azul", bg: "bg-mark-blue" },
  { color: HIGHLIGHT_COLORS.PINK, label: "Rosa", bg: "bg-mark-pink" },
  { color: HIGHLIGHT_COLORS.ORANGE, label: "Naranja", bg: "bg-mark-orange" },
];

/**
 * ContextMenu — menú flotante sobre la selección de texto.
 * Posicionamiento absoluto respecto al viewport, con clamp.
 * Aparece con animación context-pop.
 */
export function ContextMenu({
  selection,
  onClose,
  onHighlight,
  onAddNote,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Posición: encima de la selección, centrado.
  // NOTA (B12): selection.rect se calcula en useTextSelection con debounce 180ms.
  // Si el usuario hace scroll rápido tras seleccionar, el rect puede ser stale.
  // Como el menú es position:fixed y rect es viewport-relative, la posición
  // es correcta al momento de abrir. Si el usuario scrolla con el menú abierto,
  // el menú se queda flotando en la posición vieja — aceptable para v1.
  // Para v2: escuchar scroll y re-posicionar o cerrar.
  const rect = selection.rect;
  const menuWidth = 280;
  const menuHeight = 56;

  let x = rect.left + rect.width / 2 - menuWidth / 2;
  let y = rect.top - menuHeight - 12;

  // Clamp horizontal
  x = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12));
  // Si no cabe arriba, poner abajo
  if (y < 12) y = rect.bottom + 12;
  // Si tampoco cabe abajo (viewport muy pequeño), centrar verticalmente
  if (y + menuHeight > window.innerHeight - 12) {
    y = Math.max(12, (window.innerHeight - menuHeight) / 2);
  }

  // Cerrar al click fuera o Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Acciones sobre selección"
      className={cn(
        "fixed z-[100] animate-context-pop",
        "flex items-center gap-1 rounded-full",
        "bg-ink-200 p-1.5 shadow-[var(--shadow-lift)]",
        "ring-1 ring-ink-50/10",
      )}
      style={{ left: x, top: y, width: menuWidth }}
    >
      {/* Swatches */}
      <div className="flex items-center gap-1 pl-1">
        {SWATCHES.map((s) => (
          <button
            key={s.color}
            role="menuitemradio"
            aria-label={`Subrayado ${s.label}`}
            onClick={() => {
              onHighlight(s.color);
              onClose();
            }}
            className={cn(
              "h-6 w-6 rounded-full transition-transform",
              "hover:scale-125 active:scale-110",
              "ring-1 ring-black/10 dark:ring-white/10",
              s.bg,
            )}
          />
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-paper-50/15" />

      {/* Note */}
      <button
        role="menuitem"
        aria-label="Añadir nota"
        onClick={() => {
          onAddNote();
          onClose();
        }}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full px-3",
          "text-paper-50 hover:bg-paper-50/10",
          "font-ui text-xs font-medium tracking-wide",
          "transition-colors",
        )}
      >
        <IconNote width={14} height={14} />
        Nota
      </button>

      {/* Close */}
      <button
        role="menuitem"
        aria-label="Cerrar"
        onClick={onClose}
        className={cn(
          "ml-auto flex h-8 w-8 items-center justify-center rounded-full",
          "text-paper-50/60 hover:bg-paper-50/10 hover:text-paper-50",
          "transition-colors",
        )}
      >
        <IconClose width={14} height={14} />
      </button>
    </div>
  );
}
