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
  const writing = useResearchStore((s) => s.writing);
  const error = useResearchStore((s) => s.error);

  const pct = writing
    ? 100
    : total > 0
      ? Math.min(100, Math.round((step / total) * 100))
      : 4;

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
            {plan.map((item) => {
              // `writing` cuenta como hecho: el `step` nunca pasa del último
              // punto del plan, así que sin esto el último se quedaba con la
              // flecha de "en curso" durante toda la redacción —la fase más
              // larga— y parecía que se había atascado ahí.
              const done = writing || item.id < step;
              const current = !writing && item.id === step;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-start gap-1.5 font-ui text-[11px]",
                    done
                      ? "text-muted-light dark:text-muted-dark"
                      : current
                        ? "text-reading-light dark:text-reading-dark"
                        : "text-muted-light/60 dark:text-muted-dark/60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("mt-0.5", done && "text-amber-700 dark:text-amber-500")}
                  >
                    {done ? "✓" : current ? "→" : "·"}
                  </span>
                  <span className="min-w-0 break-words">{item.question}</span>
                </li>
              );
            })}
          </ul>
        )}

        {/* El error se pinta AQUÍ y no solo en el store: el backend emite
            `error` y acto seguido `done`, así que sin esto lo único que veía el
            usuario era desaparecer la barra de progreso. */}
        {error && (
          <p
            role="alert"
            className="mt-2 font-ui text-[11px] text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
          {docs} publicaciones leídas. Puedes cerrar la app y volver.
        </p>
      </div>
    </div>
  );
}
