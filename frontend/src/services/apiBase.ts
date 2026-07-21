/** API co-locada en producción; el servidor de desarrollo conserva el backend local. */
export const API_BASE = import.meta.env.VITE_AI_API_BASE ?? (
  import.meta.env.DEV ? "http://localhost:8000" : window.location.origin
);
