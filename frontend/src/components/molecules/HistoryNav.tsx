import { cn } from "@/utils/cn";
import { IconArrowLeft, IconArrowRight } from "@/components/atoms/Icons";

interface HistoryNavProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  className?: string;
}

/**
 * HistoryNav — botones Atrás/Adelante para el historial
 * de navegación de referencias.
 */
export function HistoryNav({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  className,
}: HistoryNavProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <button
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Atrás"
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-md xl:h-9 xl:w-9 pointer-coarse:h-11 pointer-coarse:w-11",
          "transition-colors",
          canGoBack
            ? "text-reading-light hover:bg-paper-200 dark:text-reading-dark dark:hover:bg-ink-50"
            : "text-muted-light/40 dark:text-muted-dark/40",
        )}
      >
        <IconArrowLeft width={16} height={16} />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Adelante"
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-md xl:h-9 xl:w-9 pointer-coarse:h-11 pointer-coarse:w-11",
          "transition-colors",
          canGoForward
            ? "text-reading-light hover:bg-paper-200 dark:text-reading-dark dark:hover:bg-ink-50"
            : "text-muted-light/40 dark:text-muted-dark/40",
        )}
      >
        <IconArrowRight width={16} height={16} />
      </button>
    </div>
  );
}
