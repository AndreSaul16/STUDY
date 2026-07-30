/**
 * researchStore — la investigación profunda en curso.
 *
 * El estado clave es `lastEventId`, y se persiste en `localStorage`: los
 * trabajos viven en la memoria del backend y un redeploy de Railway los mata.
 * Con el id del último evento visto, reconectar reemite solo lo que falta, y si
 * el trabajo ya no existe (404) la app puede ofrecer relanzarlo sin haber
 * perdido lo que se leyó.
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
  lastEventId: number;
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
      lastEventId: typeof s.lastEventId === "number" ? s.lastEventId : 0,
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
  /** Trabajo guardado que no está siendo seguido: banner de "Reanudar". */
  resumable: StoredJob | null;

  start: (
    jobId: string,
    conversationId: string | null,
    question: string,
    estimatedSeconds: number,
  ) => void;
  setPlan: (plan: ResearchPlanItem[]) => void;
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
  resumable: null,

  start: (jobId, conversationId, question, estimatedSeconds) => {
    writeStored({ jobId, conversationId, lastEventId: 0, plan: [], question });
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
      resumable: null,
    });
  },

  setPlan: (plan) => {
    const { jobId, conversationId, lastEventId, question } = get();
    if (jobId) {
      writeStored({ jobId, conversationId, lastEventId, plan, question });
    }
    set({ plan, total: plan.length });
  },

  setProgress: ({ step, total, label, docs, elapsedMs }) =>
    set((s) => ({
      step,
      total: total || s.total,
      label,
      docs,
      elapsedMs,
    })),

  setLastEventId: (lastEventId) => {
    const { jobId, conversationId, plan, question } = get();
    if (jobId) {
      writeStored({ jobId, conversationId, lastEventId, plan, question });
    }
    set({ lastEventId });
  },

  setError: (error) => set({ error }),

  finish: () => {
    writeStored(null);
    set({
      jobId: null,
      plan: [],
      step: 0,
      total: 0,
      label: "",
      docs: 0,
      elapsedMs: 0,
      lastEventId: 0,
      error: null,
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
