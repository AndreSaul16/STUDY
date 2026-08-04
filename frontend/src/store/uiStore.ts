import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppView,
  Theme,
  ResearchTab,
} from "@/types/domain";
import { APP_VIEWS, THEMES, RESEARCH_TABS } from "@/types/domain";

interface UIState {
  theme: Theme;
  /** Destino de primer nivel: chat, lectura, biblia o más. */
  view: AppView;
  activeTab: ResearchTab;
  /** Panel derecho visible en mobile (bottom sheet abierto) */
  mobileSheetOpen: boolean;
  /** Búsqueda interna del capítulo activa */
  searchOpen: boolean;
  /** Panel de investigación visible en el split de escritorio */
  researchOpen: boolean;
  /**
   * Ancho del panel de investigación, en % del ancho disponible.
   *
   * Se guarda porque es una preferencia de trabajo, no un estado de sesión:
   * quien lee capítulos largos lo quiere ancho y quien solo mira referencias
   * lo quiere estrecho, y volver a arrastrarlo en cada arranque cansa.
   */
  researchWidth: number;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setView: (v: AppView) => void;
  setActiveTab: (t: ResearchTab) => void;
  setMobileSheetOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setResearchOpen: (open: boolean) => void;
  setResearchWidth: (percent: number) => void;
}

/** Topes del arrastre. Por debajo o por encima, ninguno de los dos trabaja. */
export const RESEARCH_WIDTH_MIN = 25;
export const RESEARCH_WIDTH_MAX = 75;
export const RESEARCH_WIDTH_DEFAULT = 45;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: THEMES.LIGHT,
      // El chat es el producto: la app abre ahí.
      view: APP_VIEWS.CHAT,
      // Biblia y no Referencia: al abrir la app no hay ninguna referencia
      // activa, así que el panel arrancaba en un estado vacío. El índice
      // bíblico es accionable desde el primer segundo.
      activeTab: RESEARCH_TABS.BIBLE,
      mobileSheetOpen: false,
      searchOpen: false,
      researchOpen: true,
      researchWidth: RESEARCH_WIDTH_DEFAULT,

      toggleTheme: () =>
        set((s) => ({
          theme: s.theme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT,
        })),
      setTheme: (theme) => set({ theme }),
      setView: (view) => set({ view }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setMobileSheetOpen: (mobileSheetOpen) => set({ mobileSheetOpen }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setResearchOpen: (researchOpen) => set({ researchOpen }),
      setResearchWidth: (percent) =>
        set({
          researchWidth: Math.min(
            RESEARCH_WIDTH_MAX,
            Math.max(RESEARCH_WIDTH_MIN, Math.round(percent)),
          ),
        }),
    }),
    {
      name: "study-ui",
      // `view` también: al volver a la app se reabre donde se estaba, que en
      // un móvil es la diferencia entre retomar y volver a empezar.
      partialize: (s) => ({
        theme: s.theme,
        view: s.view,
        researchOpen: s.researchOpen,
        researchWidth: s.researchWidth,
      }),
    },
  ),
);
