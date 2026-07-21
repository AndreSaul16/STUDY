import { create } from "zustand";

/**
 * dbStore — señal de revisión de la base de datos.
 *
 * Se incrementa tras cada escritura en SQLite para que componentes que
 * leen de la DB (p. ej. NotesPanel) puedan re-consultar. No se persiste.
 */
interface DbState {
  dbRevision: number;
  bumpDbRevision: () => void;
}

export const useDbStore = create<DbState>((set) => ({
  dbRevision: 0,
  bumpDbRevision: () => set((s) => ({ dbRevision: s.dbRevision + 1 })),
}));
