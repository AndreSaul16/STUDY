import { cn } from "@/utils/cn";

interface SwitchRowProps {
  label: string;
  /** Segunda línea, más pequeña. Para el coste o la contrapartida. */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/**
 * SwitchRow — interruptor de una línea.
 *
 * Un `<button role="switch">` y no un `<input type="checkbox">`: la casilla
 * nativa mide 24 px y no hay forma decente de agrandarla, así que en un móvil
 * se falla al pulsarla. Aquí el objetivo táctil es la FILA entera, con los
 * 44 px de siempre, y la pastilla es solo la parte visible (`aria-hidden`,
 * porque lo que el lector de pantalla necesita ya está en `aria-checked`).
 *
 * Repite a propósito la forma del interruptor de `ResearchSettingsSection`:
 * es el patrón que la app ya usa y no había motivo para inventar otro.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  className,
}: SwitchRowProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-[44px] w-full items-center justify-between gap-3 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
        className,
      )}
    >
      <span className="font-ui text-sm text-reading-light dark:text-reading-dark">
        {label}
        {hint && (
          <span className="block font-ui text-[11px] text-muted-light dark:text-muted-dark">
            {hint}
          </span>
        )}
      </span>

      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full",
          "transition-colors duration-200 ease-[var(--ease-out-expo)]",
          checked ? "bg-amber-600 dark:bg-amber-700" : "bg-paper-200 dark:bg-ink-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-paper-50 shadow-sm",
            "transition-transform duration-200 ease-[var(--ease-out-expo)]",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
