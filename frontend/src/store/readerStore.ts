import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Article, Annotation, HighlightColor } from "@/types/domain";

/**
 * De dónde salió lo que se está leyendo. Se persiste para poder retomar la
 * lectura en la siguiente sesión sin guardar el artículo entero en
 * localStorage (un capítulo o un artículo de La Atalaya no caben cómodamente
 * ahí, y además el contenido puede cambiar en origen).
 */
export type ReadingSource =
  | { kind: "bible"; book: string; chapter: number }
  | { kind: "wol"; docId: number }
  | { kind: "daily"; dateIso: string }
  | { kind: "jwpub"; symbol: string; documentIndex: number };

export interface LastRead {
  source: ReadingSource;
  title: string;
  /** Fracción de scroll (0-1) para devolver al usuario donde lo dejó. */
  progress: number;
  at: number;
}

interface ReaderState {
  /** null = no hay nada abierto → el lector muestra la pantalla de inicio. */
  article: Article | null;
  source: ReadingSource | null;
  loading: boolean;
  error: string | null;

  annotations: Annotation[];
  editingNoteId: string | null;

  /** Última lectura, persistida entre sesiones. */
  lastRead: LastRead | null;

  setArticle: (article: Article, source: ReadingSource) => void;
  closeArticle: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setProgress: (progress: number) => void;

  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">, id?: string) => string;
  removeAnnotation: (id: string) => void;
  updateAnnotationColor: (id: string, color: HighlightColor) => void;
  updateAnnotationNote: (id: string, note: string | null) => void;
  setEditingNote: (id: string | null) => void;
  annotationsForBlock: (blockId: number) => Annotation[];
}

const genId = () =>
  `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      article: null,
      source: null,
      loading: false,
      error: null,
      annotations: [],
      editingNoteId: null,
      lastRead: null,

      setArticle: (article, source) =>
        set({
          article,
          source,
          loading: false,
          error: null,
          annotations: [],
          editingNoteId: null,
          lastRead: {
            source,
            title: article.title,
            progress: 0,
            at: Date.now(),
          },
        }),

      closeArticle: () =>
        set({
          article: null,
          source: null,
          error: null,
          annotations: [],
          editingNoteId: null,
        }),

      setLoading: (loading) => set({ loading, ...(loading ? { error: null } : {}) }),

      setError: (error) => set({ error, loading: false }),

      setProgress: (progress) =>
        set((s) =>
          s.lastRead
            ? { lastRead: { ...s.lastRead, progress, at: Date.now() } }
            : {},
        ),

      setAnnotations: (annotations) => set({ annotations }),

      addAnnotation: (a, id) => {
        const annId = id ?? genId();
        const annotation: Annotation = { ...a, id: annId, createdAt: Date.now() };
        set((s) => ({ annotations: [...s.annotations, annotation] }));
        return annId;
      },

      removeAnnotation: (id) =>
        set((s) => ({
          annotations: s.annotations.filter((a) => a.id !== id),
          editingNoteId: s.editingNoteId === id ? null : s.editingNoteId,
        })),

      updateAnnotationColor: (id, color) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, color } : a,
          ),
        })),

      updateAnnotationNote: (id, note) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, note } : a,
          ),
        })),

      setEditingNote: (editingNoteId) => set({ editingNoteId }),

      annotationsForBlock: (blockId) =>
        get().annotations.filter((a) => a.blockId === blockId),
    }),
    {
      name: "study-reader",
      // Sólo el puntero a la última lectura. El contenido se vuelve a pedir
      // y las anotaciones viven en SQLite, que es su fuente de verdad.
      partialize: (s) => ({ lastRead: s.lastRead }),
    },
  ),
);
