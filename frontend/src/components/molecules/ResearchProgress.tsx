import { cn } from "@/utils/cn";
import { useResearchStore } from "@/store/researchStore";

/** "3 min 20 s" — sin librerías de fechas. */
function humanTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/**
 * ResearchProgress — la espera de una investigación profunda.
 *
 * Sustituye al `ToolActivityTrail` porque el problema es otro: no son treinta
 * segundos sino tres o cuatro minutos, y hay un plan que enseñar. Ver el plan
 * con sus checkmarks convierte una espera opaca en una espera con forma, y de
 * paso le dice al usuario qué va a recibir.
 */
export function ResearchProgress() {
  const plan = useResearchStore((s) => s.plan);
  const step = useResearchStore((s) => s.step);
  const total = useResearchStore((s) => s.total);
  const label = useResearchStore((s) => s.label);
  const docs = useResearchStore((s) => s.docs);
  const elapsedMs = useResearchStore((s) => s.elapsedMs);
  const estimatedSeconds = useResearchStore((s) => s.estimatedSeconds);

  const pct = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 4;

  return (
    <div className="mb-4 max-w-[68ch]" aria-live="polite">
      <div className="rounded-2xl bg-paper-100 px-4 py-3 dark:bg-ink-50">
        <div className="flex items-center justify-between gap-2">
          <span className="font-ui text-xs font-medium text-reading-light dark:text-reading-dark">
            Investigando a fondo
          </span>
          <span className="font-ui text-[11px] text-muted-light dark:text-muted-dark">
            {humanTime(elapsedMs)} de ≈{Math.round(estimatedSeconds / 60)} min
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progreso de la investigación"
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-ink-100"
        >
          <div
            className="h-full rounded-full bg-amber-600 transition-[width] duration-500 dark:bg-amber-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {label && (
          <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            {label}
          </p>
        )}

        {plan.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-seam-light pt-2 dark:border-seam-dark">
            {plan.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-1.5 font-ui text-[11px]",
                  item.id < step
                    ? "text-muted-light dark:text-muted-dark"
                    : item.id === step
                      ? "text-reading-light dark:text-reading-dark"
                      : "text-muted-light/60 dark:text-muted-dark/60",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5",
                    item.id < step ? "text-amber-700 dark:text-amber-500" : "",
                  )}
                >
                  {item.id < step ? "✓" : item.id === step ? "→" : "·"}
                </span>
                <span className="min-w-0 break-words">{item.question}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
          {docs} publicaciones leídas. Puedes cerrar la app y volver.
        </p>
      </div>
    </div>
  );
}
