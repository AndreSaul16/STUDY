import { cn } from "@/utils/cn";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

interface CopyButtonProps {
  /** Se pide en el clic y no antes: así no se serializa nada hasta que hace falta. */
  getText: () => string;
  label?: string;
  /** Solo el icono; la etiqueta va en aria-label. */
  compact?: boolean;
  className?: string;
}

/**
 * CopyButton — copiar al portapapeles con confirmación visible.
 *
 * 44×44 mínimo (objetivo táctil) y `aria-live` para que un lector de pantalla
 * anuncie que se copió: sin confirmación, el usuario pulsa dos y tres veces
 * sin saber si funcionó.
 */
export function CopyButton({
  getText,
  label = "Copiar",
  compact = false,
  className,
}: CopyButtonProps) {
  const { copy, copied } = useCopyToClipboard();

  return (
    <button
      onClick={() => void copy(getText())}
      aria-label={copied ? "Copiado" : label}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full",
        compact ? "min-w-[44px] px-2" : "px-3",
        "font-ui text-xs font-medium",
        "transition-colors duration-200 ease-[var(--ease-out-expo)]",
        copied
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark",
        className,
      )}
    >
      <CopyIcon copied={copied} />
      <span aria-live="polite" className={cn(compact && "sr-only")}>
        {copied ? "Copiado" : label}
      </span>
    </button>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {copied ? (
        <path d="M4 12.5 9 17.5 20 6.5" />
      ) : (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </>
      )}
    </svg>
  );
}
