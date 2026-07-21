import { useCallback, useMemo, useRef } from "react";
import { getReferenceEngine } from "@/engine/ReferenceEngine";
import { useReferenceStore } from "@/store/referenceStore";
import { useUIStore } from "@/store/uiStore";
import { RESEARCH_TABS, LOAD_STATES } from "@/types/domain";
import type { LoadState } from "@/types/domain";
import type {
  CacheStats,
  DetectedReference,
  Reference,
  ResolvedReference,
} from "@/types/reference";

/**
 * useReferenceEngine — puente entre el ReferenceEngine y la UI de React.
 *
 * Responsabilidades:
 *  1. **Detectar** referencias en texto del panel izquierdo (via engine.detect).
 *  2. **Resolver** al hacer clic en una referencia detectada (via engine.resolveReference).
 *  3. **Sincronizar** el resultado con el referenceStore (panel derecho).
 *  4. **Navegar** el historial (back/forward) re-resolviendo desde caché o engine.
 *  5. **Gestionar** favoritos.
 *  6. **Exponer** estadísticas de caché para debugging/UI.
 *
 * Flujo de datos:
 *   Usuario clic en referencia detectada
 *     → hook.openReference(ref)
 *       → store.setLoadState(LOADING)  [skeleton visible]
 *       → engine.resolveReference(ref) [cache-first]
 *         → cache hit: instantáneo
 *         → cache miss: resolver mock + latencia simulada
 *       → store.setActive(ref, resolved)  [panel derecho actualizado]
 *       → uiStore.setActiveTab(REFERENCE) + setMobileSheetOpen(true)
 *
 * El hook NO contiene lógica de negocio — solo orquesta.
 * El engine NO conoce React — solo detecta y resuelve.
 * El store NO conoce el engine — solo guarda estado.
 */

interface UseReferenceEngineReturn {
  // ─── Detección ───
  /** Detecta todas las referencias en un texto */
  detectReferences: (text: string) => DetectedReference[];
  /** Detecta referencias únicas (dedup por identifier) */
  detectUniqueReferences: (text: string) => DetectedReference[];

  // ─── Resolución ───
  /** Abre una referencia: resuelve, actualiza store, abre panel derecho */
  openReference: (ref: Reference) => Promise<void>;
  /** Resuelve sin abrir el panel (para prefetch) */
  prefetchReference: (ref: Reference) => Promise<void>;

  // ─── Estado del panel derecho ───
  /** Referencia activa actual */
  activeReference: Reference | null;
  /** Contenido resuelto actual */
  resolvedContent: ResolvedReference | null;
  /** Estado de carga */
  loadState: LoadState;

  // ─── Navegación ───
  /** Ir atrás en el historial */
  goBack: () => Promise<void>;
  /** Ir adelante en el historial */
  goForward: () => Promise<void>;
  /** ¿Puede ir atrás? */
  canGoBack: boolean;
  /** ¿Puede ir adelante? */
  canGoForward: boolean;

  // ─── Favoritos ───
  /** Toggle favorito de la referencia activa o dada */
  toggleFavorite: (identifier: string) => void;
  /** ¿Es favorito? */
  isFavorite: (identifier: string) => boolean;
  /** Lista de favoritos */
  favorites: string[];

  // ─── Caché ───
  /** Estadísticas de la caché LRU */
  cacheStats: CacheStats;
  /** ¿Está esta referencia en caché? */
  isCached: (identifier: string) => boolean;
  /** Vaciar caché */
  clearCache: () => void;

  // ─── Engine (acceso directo para casos avanzados) ───
  /** Instancia del engine */
  engine: ReturnType<typeof getReferenceEngine>;
}

export function useReferenceEngine(): UseReferenceEngineReturn {
  const engine = useMemo(() => getReferenceEngine(), []);

  // Store selectors
  const activeReference = useReferenceStore((s) => s.activeReference);
  const resolvedContent = useReferenceStore((s) => s.resolvedContent);
  const loadState = useReferenceStore((s) => s.loadState);
  const setActive = useReferenceStore((s) => s.setActive);
  const showResolved = useReferenceStore((s) => s.showResolved);
  const goBackStore = useReferenceStore((s) => s.goBack);
  const goForwardStore = useReferenceStore((s) => s.goForward);
  const canGoBackStore = useReferenceStore((s) => s.canGoBack());
  const canGoForwardStore = useReferenceStore((s) => s.canGoForward());
  const favorites = useReferenceStore((s) => s.favorites);
  const toggleFavoriteStore = useReferenceStore((s) => s.toggleFavorite);
  const isFavoriteStore = useReferenceStore((s) => s.isFavorite);

  // UI store
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setMobileSheetOpen = useUIStore((s) => s.setMobileSheetOpen);

  // Ref para evitar re-resoluciones duplicadas del mismo identifier
  const resolvingRef = useRef<Set<string>>(new Set());

  // ─── Detección ────────────────────────────────────────────────

  const detectReferences = useCallback(
    (text: string): DetectedReference[] => engine.detect(text),
    [engine],
  );

  const detectUniqueReferences = useCallback(
    (text: string): DetectedReference[] => engine.detectUnique(text),
    [engine],
  );

  // ─── Resolución ───────────────────────────────────────────────

  const openReference = useCallback(
    async (ref: Reference): Promise<void> => {
      // Evitar doble-resolución si ya está en curso
      if (resolvingRef.current.has(ref.identifier)) return;
      resolvingRef.current.add(ref.identifier);

      try {
        // Si no está en caché, mostrar skeleton
        const wasCached = engine.isCached(ref.identifier);
        if (!wasCached) {
          // El store ya está en LOADING si venimos de goBack/goForward
          // Solo forzamos LOADING si no estaba ya
          useReferenceStore.setState({ loadState: LOAD_STATES.LOADING });
        }

        // Abrir panel derecho + tab de referencia
        setActiveTab(RESEARCH_TABS.REFERENCE);
        setMobileSheetOpen(true);

        // Resolver (cache-first en el engine)
        const resolved = await engine.resolveReference(ref);

        // Actualizar store
        setActive(ref, resolved);
      } finally {
        resolvingRef.current.delete(ref.identifier);
      }
    },
    [engine, setActive, setActiveTab, setMobileSheetOpen],
  );

  const prefetchReference = useCallback(
    async (ref: Reference): Promise<void> => {
      await engine.prefetch(ref);
    },
    [engine],
  );

  // ─── Navegación historial ─────────────────────────────────────

  // Resuelve el identifier destino tras mover el cursor: intenta caché y,
  // si falló (LRU evicta), re-resuelve desde historyRefs SIN re-empujar historial.
  const applyHistoryEntry = useCallback(
    async (identifier: string): Promise<void> => {
      const cached = engine.peekCache(identifier);
      if (cached) {
        showResolved(cached.reference, { ...cached, source: "cache" as const });
        return;
      }
      const ref = useReferenceStore.getState().historyRefs[identifier];
      if (!ref) return; // No hay forma de re-resolver
      const resolved = await engine.resolveReference(ref);
      showResolved(ref, resolved);
    },
    [engine, showResolved],
  );

  const goBack = useCallback(async (): Promise<void> => {
    const { history, historyCursor } = useReferenceStore.getState();
    if (historyCursor <= 0) return;

    const newCursor = historyCursor - 1;
    const identifier = history[newCursor];
    if (!identifier) return; // Check ANTES de mover cursor → evita estado inconsistente

    goBackStore(); // mueve cursor y pone LOADING
    await applyHistoryEntry(identifier);
  }, [goBackStore, applyHistoryEntry]);

  const goForward = useCallback(async (): Promise<void> => {
    const { history, historyCursor } = useReferenceStore.getState();
    if (historyCursor >= history.length - 1) return;

    const newCursor = historyCursor + 1;
    const identifier = history[newCursor];
    if (!identifier) return;

    goForwardStore();
    await applyHistoryEntry(identifier);
  }, [goForwardStore, applyHistoryEntry]);

  // ─── Caché ────────────────────────────────────────────────────

  const cacheStats = useMemo(() => engine.getCacheStats(), [engine, loadState]);

  const isCached = useCallback(
    (identifier: string) => engine.isCached(identifier),
    [engine],
  );

  const clearCache = useCallback(() => engine.clearCache(), [engine]);

  return {
    detectReferences,
    detectUniqueReferences,
    openReference,
    prefetchReference,
    activeReference,
    resolvedContent,
    loadState,
    goBack,
    goForward,
    canGoBack: canGoBackStore,
    canGoForward: canGoForwardStore,
    toggleFavorite: toggleFavoriteStore,
    isFavorite: isFavoriteStore,
    favorites,
    cacheStats,
    isCached,
    clearCache,
    engine,
  };
}
