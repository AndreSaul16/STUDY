import { create } from "zustand";
import type { JWPUBDocument, JWPUBTOCItem, JWPUBPublication } from "@/services/jwpubClient";

interface LibraryState {
  /** Publicaciones cargadas en el backend */
  publications: JWPUBPublication[];
  /** Publicación activa (la que se está leyendo) */
  activePublication: JWPUBPublication | null;
  /** Documentos de la publicación activa */
  documents: JWPUBDocument[];
  /** TOC de la publicación activa */
  toc: JWPUBTOCItem[];
  /** Documento activo (índice dentro de documents) */
  activeDocumentIndex: number;
  /** Estado de carga */
  loading: boolean;
  /** Error si falló la carga */
  error: string | null;

  /** Carga una publicación en el reader */
  loadPublication: (pub: JWPUBPublication, documents: JWPUBDocument[], toc: JWPUBTOCItem[]) => void;
  /** Cambia el documento activo */
  setActiveDocument: (index: number) => void;
  /** Resetea el estado */
  reset: () => void;
  /** ¿Hay una publicación cargada? */
  hasPublication: () => boolean;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  publications: [],
  activePublication: null,
  documents: [],
  toc: [],
  activeDocumentIndex: 0,
  loading: false,
  error: null,

  loadPublication: (pub, documents, toc) =>
    set({
      activePublication: pub,
      documents,
      toc,
      activeDocumentIndex: 0,
      loading: false,
      error: null,
    }),

  setActiveDocument: (index) =>
    set({ activeDocumentIndex: index }),

  reset: () =>
    set({
      activePublication: null,
      documents: [],
      toc: [],
      activeDocumentIndex: 0,
      loading: false,
      error: null,
    }),

  hasPublication: () => get().activePublication !== null,
}));
