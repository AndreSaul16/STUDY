import type { ResearchTab } from "@/types/domain";
import { RESEARCH_TABS } from "@/types/domain";
import { cn } from "@/utils/cn";

interface TabBarProps {
  active: ResearchTab;
  onChange: (t: ResearchTab) => void;
  /** Contadores opcionales para badges */
  counts?: Partial<Record<ResearchTab, number>>;
}

const TABS: { id: ResearchTab; label: string }[] = [
  { id: RESEARCH_TABS.LIBRARY, label: "Libros" },
  { id: RESEARCH_TABS.REFERENCE, label: "Referencia" },
  { id: RESEARCH_TABS.ANNOTATIONS, label: "Anotaciones" },
  { id: RESEARCH_TABS.FAVORITES, label: "Favoritos" },
  { id: RESEARCH_TABS.NOTES, label: "Notas" },
  { id: RESEARCH_TABS.AI, label: "IA" },
  { id: RESEARCH_TABS.CHAT, label: "Chat" },
  { id: RESEARCH_TABS.INTEROP, label: "Sync" },
];

/**
 * TabBar — pestañas del panel derecho.
 * Estilo editorial: underline ámbar en activo, no pill genérico.
 */
export function TabBar({ active, onChange, counts = {} }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-seam-light dark:border-seam-dark">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const count = counts[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative px-3 py-2.5",
              "font-ui text-xs font-medium tracking-wide",
              "transition-colors",
              isActive
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark",
            )}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[9px] tabular-nums",
                    isActive
                      ? "bg-amber-600 text-paper-50"
                      : "bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark",
                  )}
                >
                  {count}
                </span>
              )}
            </span>
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-amber-600 dark:bg-amber-500" />
            )}
          </button>
        );
      })}
    </div>
  );
}
