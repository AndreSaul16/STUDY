import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Theme,
  ResearchTab,
} from "@/types/domain";
import { THEMES, RESEARCH_TABS } from "@/types/domain";

interface UIState {
  theme: Theme;
  activeTab: ResearchTab;
  /** Panel derecho visible en mobile (bottom sheet abierto) */
  mobileSheetOpen: boolean;
  /** Búsqueda interna del capítulo activa */
  searchOpen: boolean;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setActiveTab: (t: ResearchTab) => void;
  setMobileSheetOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: THEMES.LIGHT,
      activeTab: RESEARCH_TABS.REFERENCE,
      mobileSheetOpen: false,
      searchOpen: false,

      toggleTheme: () =>
        set((s) => ({
          theme: s.theme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT,
        })),
      setTheme: (theme) => set({ theme }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setMobileSheetOpen: (mobileSheetOpen) => set({ mobileSheetOpen }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
    }),
    {
      name: "study-ui",
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
