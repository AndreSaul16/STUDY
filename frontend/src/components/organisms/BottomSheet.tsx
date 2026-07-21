import { useEffect } from "react";
import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { IconClose, IconGrip } from "@/components/atoms/Icons";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";

/**
 * BottomSheet — panel inferior deslizante para móvil.
 * Aparece con animación sheet-up, overlay sutil, y un grip handle.
 * Contiene el ResearchPanel completo.
 */
export function BottomSheet() {
  const open = useUIStore((s) => s.mobileSheetOpen);
  const setOpen = useUIStore((s) => s.setMobileSheetOpen);

  // Lock scroll del body cuando está abierto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] md:hidden">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink-400/40 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Panel de investigación"
        className={cn(
          "absolute inset-x-0 bottom-0",
          "h-[85vh] rounded-t-2xl",
          "bg-paper-50 dark:bg-ink-100",
          "shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.3)]",
          "animate-sheet-up",
          "flex flex-col",
        )}
      >
        {/* Grip + close */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
          <div className="mx-auto flex h-8 w-12 items-center justify-center">
            <IconGrip width={24} height={24} className="text-muted-light dark:text-muted-dark" />
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar panel"
            className="absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted-light hover:bg-paper-200 dark:text-muted-dark dark:hover:bg-ink-50"
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-hidden">
          <ResearchPanel className="h-full" />
        </div>
      </div>
    </div>
  );
}
