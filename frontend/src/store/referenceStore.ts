import { create } from "zustand";
import type {
  Reference,
  ResolvedReference,
} from "@/types/reference";
import { LOAD_STATES } from "@/types/domain";
import type { LoadState } from "@/types/domain";

/**
 * referenceStore — estado del panel derecho (ResearchPanel).
 *
 * Refactorizado para trabajar con el ReferenceEngine:
 *  - activeReference ahora es `Reference | null` (el modelo normalizado)
 *  - resolvedContent es `ResolvedReference | null` (lo que devolvió el engine)
 *  - El historial guarda identifiers (strings) que el engine puede re-resolver
 *
 * El hook useReferenceEngine orquesta: engine.resolveReference() → store.setActive()
 */

interface ReferenceState {
  /** Referencia activa (modelo normalizado del engine) */
  activeReference: Reference | null;
  /** Contenido resuelto por el engine (lo que muestra el panel) */
  resolvedContent: ResolvedReference | null;
  /** Estado de carga para skeleton */
  loadState: LoadState;
  /** Historial de identifiers navegados */
  history: string[];
  /** Índice actual en el historial (para back/forward) */
  historyCursor: number;
  /** Referencias visitadas por identifier (para re-resolver al navegar) */
  historyRefs: Record<string, Reference>;
  /** Favoritos — identifiers marcados */
  favorites: string[];

  /** Establece la referencia activa y su contenido resuelto (empuja al historial) */
  setActive: (ref: Reference, resolved: ResolvedReference) => void;
  /** Muestra una referencia resuelta SIN alterar el historial (para back/forward) */
  showResolved: (ref: Reference, resolved: ResolvedReference) => void;
  /** Navega atrás en el historial */
  goBack: () => void;
  /** Navega adelante en el historial */
  goForward: () => void;
  /** ¿Hay historial atrás? */
  canGoBack: () => boolean;
  /** ¿Hay historial adelante? */
  canGoForward: () => boolean;
  /** Marca/desmarca favorito */
  toggleFavorite: (identifier: string) => void;
  /** ¿Es favorito? */
  isFavorite: (identifier: string) => boolean;
  /** Resetea el estado */
  reset: () => void;
}

export const useReferenceStore = create<ReferenceState>((set, get) => ({
  activeReference: null,
  resolvedContent: null,
  loadState: LOAD_STATES.IDLE,
  history: [],
  historyCursor: -1,
  historyRefs: {},
  favorites: [],

  setActive: (ref, resolved) => {
    const { history, historyCursor, historyRefs } = get();
    // Truncar historial adelante
    const truncated = history.slice(0, historyCursor + 1);
    const newHistory = [...truncated, ref.identifier];

    set({
      activeReference: ref,
      resolvedContent: resolved,
      loadState: LOAD_STATES.LOADED,
      history: newHistory,
      historyCursor: newHistory.length - 1,
      historyRefs: { ...historyRefs, [ref.identifier]: ref },
    });
  },

  showResolved: (ref, resolved) => {
    // Actualiza el panel sin tocar history/historyCursor (navegación back/forward)
    set((s) => ({
      activeReference: ref,
      resolvedContent: resolved,
      loadState: LOAD_STATES.LOADED,
      historyRefs: { ...s.historyRefs, [ref.identifier]: ref },
    }));
  },

  goBack: () => {
    const { historyCursor } = get();
    if (historyCursor <= 0) return;
    const newCursor = historyCursor - 1;
    // El engine debe re-resolver al navegar atrás
    set({ historyCursor: newCursor, loadState: LOAD_STATES.LOADING });
  },

  goForward: () => {
    const { history, historyCursor } = get();
    if (historyCursor >= history.length - 1) return;
    const newCursor = historyCursor + 1;
    set({ historyCursor: newCursor, loadState: LOAD_STATES.LOADING });
  },

  canGoBack: () => get().historyCursor > 0,
  canGoForward: () => get().historyCursor < get().history.length - 1,

  toggleFavorite: (identifier) => {
    const { favorites } = get();
    if (favorites.includes(identifier)) {
      set({ favorites: favorites.filter((f) => f !== identifier) });
    } else {
      set({ favorites: [...favorites, identifier] });
    }
  },

  isFavorite: (identifier) => get().favorites.includes(identifier),

  reset: () =>
    set({
      activeReference: null,
      resolvedContent: null,
      loadState: LOAD_STATES.IDLE,
      history: [],
      historyCursor: -1,
      historyRefs: {},
    }),
}));
