import { cn } from "@/utils/cn";
import { IconSearch, IconClose, IconArrowUp, IconArrowDown } from "@/components/atoms/Icons";

interface SearchBarProps {
  query: string;
  onChange: (q: string) => void;
  onClear: () => void;
  onNext: () => void;
  onPrev: () => void;
  label: string;
  className?: string;
}

/**
 * SearchBar — barra de búsqueda interna tipo Ctrl+F.
 * Compacta, con contador de resultados y navegación.
 */
export function SearchBar({
  query,
  onChange,
  onClear,
  onNext,
  onPrev,
  label,
  className,
}: SearchBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full",
        "bg-paper-50 dark:bg-ink-50",
        "ring-1 ring-seam-light dark:ring-seam-dark",
        "px-3 py-1.5",
        "shadow-[var(--shadow-press)]",
        className,
      )}
    >
      <IconSearch
        width={15}
        height={15}
        className="shrink-0 text-muted-light dark:text-muted-dark"
      />

      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar en el capítulo…"
        className={cn(
          "min-w-0 flex-1 bg-transparent",
          "font-ui text-sm text-reading-light dark:text-reading-dark",
          "placeholder:text-muted-light/60 dark:placeholder:text-muted-dark/60",
          "focus:outline-none",
        )}
        aria-label="Buscar texto"
      />

      {query && (
        <>
          <span className="shrink-0 font-ui text-[11px] tabular-nums text-muted-light dark:text-muted-dark">
            {label}
          </span>
          <div className="flex shrink-0 items-center">
            <button
              onClick={onPrev}
              aria-label="Resultado anterior"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-300 dark:hover:text-reading-dark"
            >
              <IconArrowUp width={13} height={13} />
            </button>
            <button
              onClick={onNext}
              aria-label="Resultado siguiente"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-300 dark:hover:text-reading-dark"
            >
              <IconArrowDown width={13} height={13} />
            </button>
          </div>
          <button
            onClick={onClear}
            aria-label="Limpiar búsqueda"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-300 dark:hover:text-reading-dark"
          >
            <IconClose width={13} height={13} />
          </button>
        </>
      )}
    </div>
  );
}
