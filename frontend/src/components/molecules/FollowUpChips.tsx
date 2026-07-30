import { cn } from "@/utils/cn";

interface FollowUpChipsProps {
  suggestions: string[];
  /** Rellena el composer SIN enviar: el usuario puede matizar antes. */
  onPick: (suggestion: string) => void;
  className?: string;
}

/**
 * FollowUpChips — las tres preguntas de continuación.
 *
 * Deliberadamente NO envían al pulsarlas: rellenan el composer y le dan el
 * foco. Casi siempre el usuario quiere retocar el matiz antes de mandarla, y
 * un envío automático le quitaría esa oportunidad.
 */
export function FollowUpChips({
  suggestions,
  onPick,
  className,
}: FollowUpChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto pb-1",
        "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      aria-label="Preguntas sugeridas"
    >
      {suggestions.slice(0, 3).map((suggestion, i) => (
        <button
          key={`${i}-${suggestion}`}
          onClick={() => onPick(suggestion)}
          className={cn(
            "flex h-11 shrink-0 max-w-[80vw] items-center rounded-full px-4",
            "border border-seam-light bg-transparent font-ui text-xs text-muted-light",
            "transition-colors duration-200 ease-[var(--ease-out-expo)]",
            "hover:border-amber-600 hover:text-amber-700 active:scale-95",
            "dark:border-seam-dark dark:text-muted-dark dark:hover:border-amber-600 dark:hover:text-amber-400",
          )}
        >
          <span className="truncate">{suggestion}</span>
        </button>
      ))}
    </div>
  );
}
