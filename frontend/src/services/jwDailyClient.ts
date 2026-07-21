/**
 * jwDailyClient — cliente HTTP para el "Texto del día" (Examinemos las Escrituras).
 *
 * Conecta con el backend FastAPI en /api/jw/daily-text.
 * Consulta normal de solo lectura (sin IA): el backend descarga y parsea
 * el texto diario de wol.jw.org.
 */

const API_BASE = import.meta.env.VITE_AI_API_BASE ?? "http://localhost:8000";

export interface DailyText {
  date_iso: string;
  date_label: string;
  theme_text: string;
  theme_scripture_ref: string;
  body: string;
  source_url: string;
}

/**
 * Obtiene el texto del día. Si `date` (YYYY-MM-DD) se omite, el backend usa hoy.
 */
export async function getDailyText(date?: string): Promise<DailyText> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`${API_BASE}/api/jw/daily-text${qs}`);

  if (!response.ok) {
    throw new Error("No se pudo obtener el texto del día");
  }

  return response.json();
}
