import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useReaderStore } from "@/store/readerStore";
import { useUIStore } from "@/store/uiStore";
import { getDailyText, type DailyText } from "@/services/jwDailyClient";
import {
  openBibleChapter,
  openDailyText,
  resumeLastRead,
} from "@/services/readerActions";
import { APP_VIEWS, RESEARCH_TABS } from "@/types/domain";
import { Divider } from "@/components/atoms/Divider";
import {
  IconBook,
  IconBookmark,
  IconChat,
  IconArrowRight,
} from "@/components/atoms/Icons";

interface HomeScreenProps {
  className?: string;
}

/**
 * HomeScreen — lo primero que ve el usuario cuando no hay nada abierto.
 *
 * Sustituye al artículo de ejemplo que se cargaba antes (un Salmo 23 con
 * comentario inventado). Todo lo que aparece aquí es contenido real traído de
 * wol.jw.org, y cada tarjeta es un punto de entrada a la lectura:
 *
 *   1. Retomar donde lo dejaste (si hay lectura previa)
 *   2. El texto del día de hoy
 *   3. Accesos directos a lecturas frecuentes
 */
export function HomeScreen({ className }: HomeScreenProps) {
  const lastRead = useReaderStore((s) => s.lastRead);
  const error = useReaderStore((s) => s.error);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setMobileSheetOpen = useUIStore((s) => s.setMobileSheetOpen);
  const setView = useUIStore((s) => s.setView);

  const openBibleTab = () => {
    setActiveTab(RESEARCH_TABS.BIBLE);
    setMobileSheetOpen(true);
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[68ch]",
        "px-1 py-6 sm:py-10",
        className,
      )}
    >
      <header className="animate-fade-rise">
        <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
          Escritorio de lectura
        </p>
        <h1 className="mt-2 font-display text-4xl leading-[1.05] text-reading-light dark:text-reading-dark sm:text-5xl">
          Lectura
        </h1>
        <Divider variant="amber" className="mt-4 w-16" />
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg bg-red-50 px-4 py-3 font-ui text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <div className="mt-8 space-y-4">
        {/* El chat es el núcleo de la app; desde la lectura tiene que estar a
            un toque, no escondido en una pestaña del panel derecho. */}
        <ActionCard
          eyebrow="Asistente"
          title="Preguntar a la IA"
          hint="Busca en las publicaciones y te lo redacta"
          icon={<IconChat width={18} height={18} />}
          onClick={() => setView(APP_VIEWS.CHAT)}
          emphasis
        />

        {lastRead && (
          <ActionCard
            eyebrow="Continuar"
            title={lastRead.title}
            hint={
              lastRead.progress > 0.02
                ? `Ibas por el ${Math.round(lastRead.progress * 100)} %`
                : "Retomar la lectura"
            }
            icon={<IconBookmark width={18} height={18} />}
            onClick={() => void resumeLastRead()}
          />
        )}

        <DailyTextPanel />

        <div className="grid gap-4 sm:grid-cols-2">
          <ActionCard
            eyebrow="Biblia"
            title="Elegir libro y capítulo"
            hint="Los 66 libros, en español"
            icon={<IconBook width={18} height={18} />}
            onClick={openBibleTab}
          />
          <ActionCard
            eyebrow="Sugerencia"
            title="Salmos 23"
            hint="Una lectura breve para empezar"
            icon={<IconBook width={18} height={18} />}
            onClick={() => void openBibleChapter("Salmos", 23)}
          />
        </div>
      </div>

      <p className="mt-10 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
        Selecciona cualquier texto para subrayarlo o anotarlo. Las citas
        bíblicas se detectan solas: púlsalas para leerlas sin perder la página.
      </p>
    </div>
  );
}

// ─── Tarjeta de acción ───────────────────────────────────────────

function ActionCard({
  eyebrow,
  title,
  hint,
  icon,
  onClick,
  emphasis = false,
}: {
  eyebrow: string;
  title: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-4 rounded-xl p-4 text-left",
        "min-h-[76px]", // área táctil cómoda en móvil
        "border transition-all duration-200 ease-[var(--ease-out-expo)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
        emphasis
          ? "border-amber-600/40 bg-amber-50/60 hover:border-amber-600 dark:border-amber-500/30 dark:bg-amber-800/10"
          : "border-seam-light bg-paper-50 hover:border-amber-600/50 dark:border-seam-dark dark:bg-ink-100",
        "hover:shadow-[var(--shadow-lift)]",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
          emphasis
            ? "bg-amber-600 text-paper-50"
            : "bg-paper-200 text-amber-700 dark:bg-ink-50 dark:text-amber-400",
        )}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block font-ui text-[10px] uppercase tracking-[0.18em] text-muted-light dark:text-muted-dark">
          {eyebrow}
        </span>
        <span className="mt-0.5 block truncate font-display text-lg text-reading-light dark:text-reading-dark">
          {title}
        </span>
        <span className="mt-0.5 block truncate font-ui text-xs text-muted-light dark:text-muted-dark">
          {hint}
        </span>
      </span>

      <IconArrowRight
        width={16}
        height={16}
        className="shrink-0 text-muted-light transition-transform duration-200 group-hover:translate-x-1 dark:text-muted-dark"
      />
    </button>
  );
}

// ─── Texto del día ───────────────────────────────────────────────

function DailyTextPanel() {
  const [data, setData] = useState<DailyText | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    getDailyText()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "error") return null;

  return (
    <section
      className={cn(
        "rounded-xl border border-seam-light bg-paper-50 p-5",
        "dark:border-seam-dark dark:bg-ink-100",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400">
          Texto del día
        </h2>
        {data && (
          <span className="font-ui text-[10px] text-muted-light dark:text-muted-dark">
            {data.date_label}
          </span>
        )}
      </div>

      {state === "loading" && (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-3 w-3/4 animate-pulse rounded bg-paper-200 dark:bg-ink-50" />
          <div className="h-3 w-full animate-pulse rounded bg-paper-200 dark:bg-ink-50" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-paper-200 dark:bg-ink-50" />
        </div>
      )}

      {data && (
        <div className="animate-fade-rise">
          <blockquote className="mt-3 font-reading text-base italic leading-relaxed text-reading-light dark:text-reading-dark">
            {data.theme_text}
          </blockquote>
          <p className="mt-3 line-clamp-3 font-reading text-sm leading-relaxed text-reading-light/75 dark:text-reading-dark/75">
            {data.body}
          </p>
          <button
            onClick={() => void openDailyText()}
            className={cn(
              "mt-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-2",
              "font-ui text-xs font-medium text-amber-700 dark:text-amber-400",
              "hover:bg-amber-50 dark:hover:bg-amber-800/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
            )}
          >
            Leer completo
            <IconArrowRight width={13} height={13} />
          </button>
        </div>
      )}
    </section>
  );
}
