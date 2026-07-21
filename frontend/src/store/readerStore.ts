import { create } from "zustand";
import type { Article, Annotation, HighlightColor } from "@/types/domain";
import { MOCK_ARTICLE } from "@/data/mockData";

interface ReaderState {
  article: Article;
  annotations: Annotation[];
  /** Anotación en edición de nota */
  editingNoteId: string | null;

  /** Carga un nuevo artículo (desde JWPUB o mock) */
  setArticle: (article: Article) => void;
  /** Reemplaza todas las anotaciones (hidratación desde SQLite) */
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">, id?: string) => string;
  removeAnnotation: (id: string) => void;
  updateAnnotationColor: (id: string, color: HighlightColor) => void;
  updateAnnotationNote: (id: string, note: string | null) => void;
  setEditingNote: (id: string | null) => void;
  /** Anotaciones de un bloque concreto */
  annotationsForBlock: (blockId: number) => Annotation[];
}

const genId = () =>
  `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useReaderStore = create<ReaderState>((set, get) => ({
  article: MOCK_ARTICLE,
  annotations: [],
  editingNoteId: null,

  setArticle: (article) => set({ article, annotations: [], editingNoteId: null }),

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
}));
