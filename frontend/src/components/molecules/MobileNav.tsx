import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { useReaderStore } from "@/store/readerStore";
import { RESEARCH_TABS } from "@/types/domain";
import type { ResearchTab } from "@/types/domain";
import {
  IconHome,
  IconBook,
  IconSearch,
  IconSparkle,
  IconChat,
} from "@/components/atoms/Icons";

/**
 * MobileNav — barra de navegación inferior (sólo <768px).
 *
 * Resuelve el agujero grande del móvil: el panel de investigación sólo se
 * abría al pulsar una cita dentro del texto, así que Biblia, Buscar, IA, Chat,
 * Notas y Sync eran literalmente inalcanzables desde el teléfono.
 *
 * Cinco destinos, los que se usan de verdad; el resto de pestañas siguen
 * accesibles dentro del propio panel. Cada botón mide 56px de alto y respeta
 * la safe-area inferior (barra gestual de iOS/Android).
 */

interface NavItem {
  id: "home" | ResearchTab;
  label: string;
  icon: typeof IconHome;
}

const ITEMS: NavItem[] = [
  { id: "home", label: "Inicio", icon: IconHome },
  { id: RESEARCH_TABS.BIBLE, label: "Biblia", icon: IconBook },
  { id: RESEARCH_TABS.SEARCH, label: "Buscar", icon: IconSearch },
  { id: RESEARCH_TABS.AI, label: "IA", icon: IconSparkle },
  { id: RESEARCH_TABS.CHAT, label: "Chat", icon: IconChat },
];

export function MobileNav() {
  const sheetOpen = useUIStore((s) => s.mobileSheetOpen);
  const setSheetOpen = useUIStore((s) => s.setMobileSheetOpen);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const article = useReaderStore((s) => s.article);
  const closeArticle = useReaderStore((s) => s.closeArticle);

  const isHomeActive = !sheetOpen && article === null;

  const go = (item: NavItem) => {
    if (item.id === "home") {
      setSheetOpen(false);
      closeArticle();
      return;
    }

    // Volver a pulsar la pestaña abierta cierra el panel y devuelve al texto.
    if (sheetOpen && activeTab === item.id) {
      setSheetOpen(false);
      return;
    }

    setActiveTab(item.id);
    setSheetOpen(true);
  };

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        // Por encima del bottom sheet (z-110): con el panel abierto se tiene
        // que poder saltar de Biblia a Chat sin cerrarlo primero.
        "fixed inset-x-0 bottom-0 z-[120] md:hidden",
        "border-t border-seam-light bg-paper-50/95 backdrop-blur",
        "dark:border-seam-dark dark:bg-ink-100/95",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex items-stretch">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.id === "home" ? isHomeActive : sheetOpen && activeTab === item.id;

          return (
            <li key={item.id} className="flex-1">
              <button
                onClick={() => go(item)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-14 w-full flex-col items-center justify-center gap-1",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500",
                  isActive
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-light dark:text-muted-dark",
                )}
              >
                <Icon width={19} height={19} />
                <span className="font-ui text-[10px] leading-none tracking-wide">
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
