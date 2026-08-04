import { useEffect, useRef } from "react";
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
  { id: RESEARCH_TABS.READER, label: "Leer" },
  { id: RESEARCH_TABS.BIBLE, label: "Biblia" },
  { id: RESEARCH_TABS.SEARCH, label: "Buscar" },
  { id: RESEARCH_TABS.REFERENCE, label: "Referencia" },
  { id: RESEARCH_TABS.LIBRARY, label: "Libros" },
  { id: RESEARCH_TABS.ANNOTATIONS, label: "Anotaciones" },
  { id: RESEARCH_TABS.FAVORITES, label: "Favoritos" },
  { id: RESEARCH_TABS.NOTES, label: "Notas" },
  { id: RESEARCH_TABS.AI, label: "IA" },
  { id: RESEARCH_TABS.CHAT, label: "Chat" },
  { id: RESEARCH_TABS.INTEROP, label: "Sync" },
];

/**
 * Las que se listan por defecto. Las otras cinco siguen existiendo y
 * `ResearchPanel` las sabe renderizar: se llega a ellas desde "Más".
 *
 * Con diez pestañas en una fila con scroll horizontal, nadie llegaba a la
 * séptima. No se borran del array para que `activeTab` pueda seguir valiendo
 * "chat" o "notes" sin dejar el panel en blanco.
 */
const PRIMARY_TABS: ResearchTab[] = [
  RESEARCH_TABS.READER,
  RESEARCH_TABS.BIBLE,
  RESEARCH_TABS.SEARCH,
  RESEARCH_TABS.REFERENCE,
  RESEARCH_TABS.LIBRARY,
  RESEARCH_TABS.ANNOTATIONS,
];

/**
 * TabBar — pestañas del panel derecho.
 *
 * Estilo editorial: subrayado ámbar en la activa, no un pill genérico.
 *
 * Con diez pestañas no caben en un panel estrecho, así que la barra hace
 * scroll horizontal y la pestaña activa se trae a la vista sola. Las flechas
 * de scroll se ocultan y se difumina el borde para que se vea que hay más.
 */
export function TabBar({ active, onChange, counts = {} }: TabBarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Si la pestaña activa cambia desde fuera (p. ej. al pulsar una cita en el
  // texto), puede quedar fuera de la zona visible del scroll.
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [active]);

  return (
    <div className="relative shrink-0 border-b border-seam-light dark:border-seam-dark">
      <div
        ref={listRef}
        role="tablist"
        className={cn(
          "flex items-center gap-0.5 overflow-x-auto",
          // Sin barra de scroll visible: la pista es el difuminado del borde.
          "[scrollbar-width:none] [-ms-overflow-style:none]",
          "[&::-webkit-scrollbar]:hidden",
          "scroll-smooth px-1",
        )}
      >
        {/* La activa se lista aunque no sea primaria: si `activeTab` vale
            "chat" o "notes", la barra tiene que reflejar dónde se está. */}
        {TABS.filter(
          (tab) => PRIMARY_TABS.includes(tab.id) || tab.id === active,
        ).map((tab) => {
          const isActive = tab.id === active;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={cn(
                // 40px con ratón; 44 con el dedo. En la franja de tablet esta
                // barra se usa a pulgar y se quedaba por debajo del mínimo.
                "relative shrink-0 whitespace-nowrap px-3 py-3",
                "flex items-center pointer-coarse:min-h-[44px]",
                "font-ui text-xs font-medium tracking-wide",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
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
                <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-amber-600 dark:bg-amber-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Difuminado en el borde derecho: señal de que la lista continúa. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper-50 to-transparent dark:from-ink-100"
      />
    </div>
  );
}
