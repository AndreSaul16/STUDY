import type { Reference, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES } from "@/types/reference";
import { cn } from "@/utils/cn";
import { Badge } from "@/components/atoms/Badge";
import { REFERENCE_ICONS } from "@/components/atoms/Icons";

// ─── Mapa de tipos a iconos ──────────────────────────────────────
// Reusa los iconos existentes, mapeando los nuevos tipos
const TYPE_ICONS = {
  [REFERENCE_TYPES.SCRIPTURE]: REFERENCE_ICONS.scripture,
  [REFERENCE_TYPES.PUBLICATION]: REFERENCE_ICONS.link,
  [REFERENCE_TYPES.FOOTNOTE]: REFERENCE_ICONS.footnote,
  [REFERENCE_TYPES.CROSS_REFERENCE]: REFERENCE_ICONS.glossary,
} as const;

const TYPE_LABELS = {
  [REFERENCE_TYPES.SCRIPTURE]: "Escritura",
  [REFERENCE_TYPES.PUBLICATION]: "Publicación",
  [REFERENCE_TYPES.FOOTNOTE]: "Nota",
  [REFERENCE_TYPES.CROSS_REFERENCE]: "Cita cruzada",
} as const;

// ─── Etiqueta legible desde una Reference ────────────────────────

export function referenceLabel(ref: Reference): string {
  switch (ref.type) {
    case REFERENCE_TYPES.SCRIPTURE: {
      const parts = [ref.publication];
      if (ref.chapter !== null) parts.push(`${ref.chapter}`);
      if (ref.paragraph !== null) parts.push(`:${ref.paragraph}`);
      return parts.filter(Boolean).join(" ");
    }
    case REFERENCE_TYPES.PUBLICATION: {
      const parts = [ref.publication];
      if (ref.chapter !== null) parts.push(`${ref.chapter}`);
      if (ref.paragraph !== null) parts.push(`#${ref.paragraph}`);
      return parts.filter(Boolean).join(" ");
    }
    case REFERENCE_TYPES.FOOTNOTE:
      return `Nota ${ref.paragraph ?? ""}`.trim();
    case REFERENCE_TYPES.CROSS_REFERENCE:
      return ref.publication ?? "Referencia";
    default:
      return ref.identifier;
  }
}

// ─── Chip inline (en el texto) ───────────────────────────────────

interface ReferenceChipProps {
  reference: Reference;
  onClick: () => void;
  className?: string;
  /** Texto del fragmento cuando una referencia se divide por un highlight. */
  label?: string;
}

export function ReferenceChip({
  reference,
  onClick,
  className,
  label,
}: ReferenceChipProps) {
  const Icon = TYPE_ICONS[reference.type];
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md",
        "px-1.5 py-0.5 align-baseline",
        "font-ui text-[0.8em] font-medium",
        "transition-all duration-200 ease-[var(--ease-out-expo)]",
        "bg-amber-50 text-amber-800 hover:bg-amber-100",
        "dark:bg-amber-800/20 dark:text-amber-300 dark:hover:bg-amber-800/30",
        className,
      )}
    >
      <Icon width={11} height={11} className="shrink-0 opacity-70" />
      <span>{label ?? referenceLabel(reference)}</span>
    </button>
  );
}

// ─── Tarjeta expandida (panel derecho) ───────────────────────────

interface ReferenceCardExpandedProps {
  reference: Reference;
  resolved: ResolvedReference;
  favorite: boolean;
  onToggleFavorite: () => void;
}

export function ReferenceCardExpanded({
  reference,
  resolved,
  favorite,
  onToggleFavorite,
}: ReferenceCardExpandedProps) {
  const Icon = TYPE_ICONS[reference.type];
  const typeLabel = TYPE_LABELS[reference.type];

  return (
    <article className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
              "bg-amber-50 text-amber-700 dark:bg-amber-800/20 dark:text-amber-400",
            )}
          >
            <Icon width={18} height={18} />
          </div>
          <div>
            <Badge tone="amber">{typeLabel}</Badge>
            <h3 className="mt-1 font-display text-2xl leading-tight text-reading-light dark:text-reading-dark">
              {resolved.title}
            </h3>
            {resolved.subtitle && (
              <p className="mt-0.5 font-ui text-xs text-muted-light dark:text-muted-dark">
                {resolved.subtitle}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={onToggleFavorite}
          aria-label={favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "transition-colors",
            favorite
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-light hover:text-amber-600 dark:text-muted-dark dark:hover:text-amber-400",
          )}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill={favorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z" />
          </svg>
        </button>
      </header>

      <div className="prose-reading text-reading-light dark:text-reading-dark">
        <p>{resolved.body}</p>
      </div>

      {/* Metadatos de resolución */}
      <div className="border-t border-seam-light pt-3 dark:border-seam-dark">
        <p className="font-ui text-[10px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
          Resuelto via · {resolved.source}
        </p>
      </div>
    </article>
  );
}
