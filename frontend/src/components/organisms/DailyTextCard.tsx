import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { getDailyText, type DailyText } from "@/services/jwDailyClient";
import { Divider } from "@/components/atoms/Divider";

interface DailyTextCardProps {
  className?: string;
}

/**
 * DailyTextCard — widget de inicio con el "Texto del día"
 * (Examinemos las Escrituras) obtenido de wol.jw.org vía el backend.
 *
 * Consulta normal (sin IA). Se carga al montar. No usa dangerouslySetInnerHTML:
 * el contenido se renderiza como texto React.
 */
export function DailyTextCard({ className }: DailyTextCardProps) {
  const [data, setData] = useState<DailyText | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    getDailyText()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const paragraphs = data
    ? data.body.split("\n\n").filter((p) => p.trim().length > 0)
    : [];

  return (
    <section
      className={cn(
        "rounded-lg border border-seam-light bg-paper-100 p-4",
        "dark:border-seam-dark dark:bg-ink-50",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-ui text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400">
          Texto del día
        </h4>
        {data?.date_label && (
          <span className="font-ui text-[10px] text-muted-light dark:text-muted-dark">
            {data.date_label}
          </span>
        )}
      </div>

      <Divider variant="amber" className="mt-2 w-12" />

      {loading && (
        <div className="mt-4 space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-paper-200 dark:bg-ink-100" />
          <div className="h-3 w-full animate-pulse rounded bg-paper-200 dark:bg-ink-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-paper-200 dark:bg-ink-100" />
        </div>
      )}

      {error && !loading && (
        <p className="mt-4 font-ui text-xs text-muted-light dark:text-muted-dark">
          No se pudo obtener el texto del día.
        </p>
      )}

      {data && !loading && !error && (
        <div className="mt-3 animate-fade-rise">
          {/* Versículo tema — destacado */}
          <blockquote className="font-reading text-sm italic leading-relaxed text-reading-light dark:text-reading-dark">
            {data.theme_text}
          </blockquote>

          {/* Comentario */}
          <div className="mt-3 space-y-2">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="font-reading text-xs leading-relaxed text-reading-light/80 dark:text-reading-dark/80"
              >
                {p}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
