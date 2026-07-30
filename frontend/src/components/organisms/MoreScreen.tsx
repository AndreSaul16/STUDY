import { useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { exportDatabase, importDatabase } from "@/db/database";
import { APP_VIEWS, RESEARCH_TABS, THEMES } from "@/types/domain";
import type { ResearchTab } from "@/types/domain";
import { Divider } from "@/components/atoms/Divider";
import { useChatModes } from "@/components/molecules/ModePicker";
import { useChatStore } from "@/store/chatStore";
import {
  IconBook,
  IconChevronDown,
  IconGlossary,
  IconLayers,
  IconLink,
  IconMoon,
  IconNote,
  IconSparkle,
  IconStar,
  IconSun,
} from "@/components/atoms/Icons";

interface MoreScreenProps {
  className?: string;
}

interface Destination {
  tab: ResearchTab;
  label: string;
  hint: string;
  icon: typeof IconNote;
}

const DESTINATIONS: Destination[] = [
  { tab: RESEARCH_TABS.NOTES, label: "Notas", hint: "Lo que has escrito", icon: IconNote },
  { tab: RESEARCH_TABS.ANNOTATIONS, label: "Anotaciones", hint: "Subrayados del lector", icon: IconGlossary },
  { tab: RESEARCH_TABS.FAVORITES, label: "Favoritos", hint: "Referencias guardadas", icon: IconStar },
  { tab: RESEARCH_TABS.LIBRARY, label: "Biblioteca", hint: "Publicaciones .jwpub", icon: IconBook },
  { tab: RESEARCH_TABS.AI, label: "Análisis", hint: "Herramientas sobre un bloque", icon: IconSparkle },
  { tab: RESEARCH_TABS.INTEROP, label: "Sincronizar", hint: "JW Library (.jwlibrary)", icon: IconLink },
];

/**
 * MoreScreen — todo lo que dejó de ser una pestaña de primer nivel.
 *
 * El panel de investigación tenía diez pestañas en una fila con scroll
 * horizontal: nadie llegaba a la séptima. Las que no son de uso diario viven
 * aquí, en tarjetas grandes, y siguen abriéndose en el mismo panel de siempre.
 */
export function MoreScreen({ className }: MoreScreenProps) {
  const setView = useUIStore((s) => s.setView);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setSheetOpen = useUIStore((s) => s.setMobileSheetOpen);

  const open = (tab: ResearchTab) => {
    setActiveTab(tab);
    setSheetOpen(true);
    setView(APP_VIEWS.READ);
  };

  return (
    <div
      className={cn(
        "h-full overflow-y-auto overscroll-contain",
        "px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-24 short:pt-4 md:pb-10",
        className,
      )}
    >
      {/* En escritorio esta pantalla también existe (el carril lateral lleva
          hasta aquí), y a 1440px una rejilla de dos columnas a sangre completa
          daría tarjetas de 700px. */}
      <div className="mx-auto w-full max-w-3xl">
      <header>
        <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
          Herramientas
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-reading-light dark:text-reading-dark">
          Más
        </h1>
        <Divider variant="amber" className="mt-4 w-16" />
      </header>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {DESTINATIONS.map((destination) => {
          const Icon = destination.icon;
          return (
            <li key={destination.tab}>
              <button
                onClick={() => open(destination.tab)}
                className={cn(
                  "flex min-h-[76px] w-full flex-col justify-center gap-1 rounded-xl px-4 py-3 text-left",
                  "border border-seam-light bg-paper-50",
                  "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                  "hover:border-amber-600 active:scale-[0.98]",
                  "dark:border-seam-dark dark:bg-ink-100",
                )}
              >
                <Icon width={17} height={17} className="text-amber-700 dark:text-amber-400" />
                <span className="font-ui text-sm font-medium text-reading-light dark:text-reading-dark">
                  {destination.label}
                </span>
                <span className="font-ui text-[11px] text-muted-light dark:text-muted-dark">
                  {destination.hint}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Settings />
      </div>
    </div>
  );
}

// ─── Ajustes ─────────────────────────────────────────────────────

function Settings() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const modes = useChatModes();

  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const doExport = () => {
    const bytes = exportDatabase();
    const url = URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `study-${new Date().toISOString().slice(0, 10)}.sqlite`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Copia descargada.");
  };

  const doImport = async (file: File) => {
    try {
      await importDatabase(new Uint8Array(await file.arrayBuffer()));
      setStatus("Copia restaurada. Recarga la app para verla.");
    } catch {
      setStatus("No se pudo restaurar esa copia.");
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
        Ajustes
      </h2>

      <div className="mt-3 divide-y divide-seam-light rounded-xl border border-seam-light dark:divide-seam-dark dark:border-seam-dark">
        <button
          onClick={toggleTheme}
          className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Tema
          </span>
          <span className="flex items-center gap-2 font-ui text-xs text-muted-light dark:text-muted-dark">
            {theme === THEMES.DARK ? "Oscuro" : "Claro"}
            {theme === THEMES.DARK ? (
              <IconMoon width={15} height={15} />
            ) : (
              <IconSun width={15} height={15} />
            )}
          </span>
        </button>

        <label className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 font-ui text-sm text-reading-light dark:text-reading-dark">
            Modo del chat por defecto
          </span>
          <span className="relative flex min-w-0 shrink-0 items-center gap-1">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="max-w-[9.5rem] appearance-none truncate bg-transparent pr-5 text-right font-ui text-xs text-muted-light outline-none dark:text-muted-dark"
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <IconChevronDown
              width={13}
              height={13}
              className="pointer-events-none absolute right-0 text-muted-light dark:text-muted-dark"
            />
          </span>
        </label>

        <button
          onClick={doExport}
          className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Exportar mi base local
          </span>
          <IconLayers width={15} height={15} className="text-muted-light dark:text-muted-dark" />
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Importar una copia
          </span>
          <IconLayers width={15} height={15} className="text-muted-light dark:text-muted-dark" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".sqlite,.db,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void doImport(file);
            e.target.value = "";
          }}
        />
      </div>

      {status && (
        <p
          role="status"
          className="mt-3 font-ui text-xs text-muted-light dark:text-muted-dark"
        >
          {status}
        </p>
      )}
    </section>
  );
}
