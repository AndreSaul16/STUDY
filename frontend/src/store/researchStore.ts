/**
 * researchStore — la investigación profunda en curso.
 *
 * Lo que se persiste en `localStorage` es la IDENTIDAD del trabajo (su id, la
 * pregunta y el plan): los trabajos viven en la memoria del backend y cerrar la
 * app —o un redeploy de Railway— deja el seguimiento colgado. Con eso guardado
 * la app ofrece "Reanudar", y si el trabajo ya no existe (404) ofrece
 * relanzarlo.
 *
 * **El `lastEventId` NO se persiste.** Se intentó, para que reanudar reemitiera
 * solo lo que faltaba, pero el texto del informe no se guarda en ninguna parte:
 * reengancharse a mitad devolvía únicamente la cola y el informe se archivaba
 * truncado. El backend conserva todos los eventos del trabajo, así que reanudar
 * los repite desde el principio —memoria local, ni una llamada al modelo— y el
 * informe se reconstruye entero. Aquí queda solo como progreso en memoria.
 *
 * Sin el middleware `persist` por el mismo motivo que en `chatStore`: en Safari
 * privado `localStorage` lanza al escribir, y eso no puede dejar la app en
 * blanco a mitad de un informe de tres minutos.
 */

import { create } from "zustand";

const RESEARCH_STORAGE_KEY = "study-research-job";

export interface ResearchPlanItem {
  id: number;
  question: string;
}

interface StoredJob {
  jobId: string;
  conversationId: string | null;
  plan: ResearchPlanItem[];
  question: string;
}

function readStored(): StoredJob | null {
  try {
    const raw = localStorage.getItem(RESEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const s = parsed as Record<string, unknown>;
    if (typeof s.jobId !== "string" || !s.jobId) return null;

    return {
      jobId: s.jobId,
      conversationId:
        typeof s.conversationId === "string" ? s.conversationId : null,
      plan: Array.isArray(s.plan) ? (s.plan as ResearchPlanItem[]) : [],
      question: typeof s.question === "string" ? s.question : "",
    };
  } catch {
    return null;
  }
}

function writeStored(job: StoredJob | null): void {
  try {
    if (job === null) localStorage.removeItem(RESEARCH_STORAGE_KEY);
    else localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(job));
  } catch {
    // Safari privado: se pierde la reanudación, no la investigación en curso.
  }
}

interface ResearchState {
  jobId: string | null;
  conversationId: string | null;
  question: string;
  plan: ResearchPlanItem[];
  /** Paso actual del plan (1-based) y total. */
  step: number;
  total: number;
  label: string;
  docs: number;
  elapsedMs: number;
  lastEventId: number;
  estimatedSeconds: number;
  error: string | null;
  /**
   * Ya no queda plan que investigar: el backend está redactando el informe.
   *
   * Es la fase más larga y el `step` no vuelve a moverse en toda ella, así que
   * sin esto el último punto del plan se queda con la flecha de "en curso"
   * hasta el final y parece que la investigación se ha atascado.
   */
  writing: boolean;
  /** Trabajo guardado que no está siendo seguido: banner de "Reanudar". */
  resumable: StoredJob | null;

  start: (
    jobId: string,
    conversationId: string | null,
    question: string,
    estimatedSeconds: number,
  ) => void;
  setPlan: (plan: ResearchPlanItem[]) => void;
  setWriting: () => void;
  setProgress: (progress: {
    step: number;
    total: number;
    label: string;
    docs: number;
    elapsedMs: number;
  }) => void;
  setLastEventId: (id: number) => void;
  setError: (error: string | null) => void;
  finish: () => void;
  hydrate: () => void;
  dismissResumable: () => void;
}

export const useResearchStore = create<ResearchState>()((set, get) => ({
  jobId: null,
  conversationId: null,
  question: "",
  plan: [],
  step: 0,
  total: 0,
  label: "",
  docs: 0,
  elapsedMs: 0,
  lastEventId: 0,
  estimatedSeconds: 240,
  error: null,
  writing: false,
  resumable: null,

  start: (jobId, conversationId, question, estimatedSeconds) => {
    writeStored({ jobId, conversationId, plan: [], question });
    set({
      jobId,
      conversationId,
      question,
      estimatedSeconds,
      plan: [],
      step: 0,
      total: 0,
      label: "",
      docs: 0,
      elapsedMs: 0,
      lastEventId: 0,
      error: null,
      writing: false,
      resumable: null,
    });
  },

  setPlan: (plan) => {
    const { jobId, conversationId, question } = get();
    if (jobId) {
      writeStored({ jobId, conversationId, plan, question });
    }
    set({ plan, total: plan.length });
  },

  setWriting: () => set({ writing: true, label: "Redactando el informe" }),

  setProgress: ({ step, total, label, docs, elapsedMs }) =>
    set((s) => ({
      step,
      total: total || s.total,
      label,
      docs,
      elapsedMs,
    })),

  setLastEventId: (lastEventId) => set({ lastEventId }),

  setError: (error) => set({ error }),

  finish: () => {
    writeStored(null);
    // `error` NO se limpia: el backend emite `error` y acto seguido `done`, así
    // que limpiarlo aquí borraba el motivo del fallo un instante después de
    // haberlo escrito y el usuario veía desaparecer la barra de progreso sin
    // una sola palabra. Lo limpia `start()` al lanzar la siguiente.
    set({
      jobId: null,
      plan: [],
      step: 0,
      total: 0,
      label: "",
      docs: 0,
      elapsedMs: 0,
      lastEventId: 0,
      writing: false,
      resumable: null,
    });
  },

  hydrate: () => {
    const stored = readStored();
    if (stored) set({ resumable: stored });
  },

  dismissResumable: () => {
    writeStored(null);
    set({ resumable: null });
  },
}));
