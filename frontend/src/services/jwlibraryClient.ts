/**
 * JWLibraryClient — cliente HTTP para los endpoints de interoperabilidad.
 *
 * Conecta con el backend FastAPI en /api/interop/*.
 * Maneja upload de archivos (multipart) y download del ZIP resultante.
 */

import { API_BASE } from "@/services/apiBase";

export interface ImportResultDTO {
  success: boolean;
  user_marks_count: number;
  notes_count: number;
  tags_count: number;
  bookmarks_count: number;
  documents: number[];
  errors: string[];
}

export interface ExportMarkDTO {
  local_id: string;
  document_id: number;
  block_index: number;
  color: number;
  ranges: { start_token: number; end_token: number; token_count: number }[];
  note?: { title: string; content: string; last_modified: string };
}

export interface ExportRequestDTO {
  marks: ExportMarkDTO[];
  tags: { name: string; color: number }[];
  note_tag_links: { note_mark_index: number; tag_name: string }[];
}

export const jwlibraryClient = {
  /**
   * Importa (analiza) un archivo .jwlibrary subido.
   * No modifica el archivo — solo lee y reporta.
   */
  async importFile(file: File): Promise<ImportResultDTO> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/interop/import`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Import failed (HTTP ${response.status})`;
      try {
        const body = await response.text();
        if (body) errorMsg = `Import failed: ${body}`;
      } catch {
        // body vacío o no legible — usar mensaje genérico
      }
      throw new Error(errorMsg);
    }

    return response.json();
  },

  /**
   * Exporta (inyecta datos) en un .jwlibrary existente.
   * Devuelve el ZIP modificado como Blob listo para descargar.
   */
  async exportToFile(
    jwlibraryFile: File,
    request: ExportRequestDTO,
  ): Promise<Blob> {
    const formData = new FormData();
    formData.append("file", jwlibraryFile);
    formData.append("request_json", JSON.stringify(request));

    const response = await fetch(`${API_BASE}/api/interop/export`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Export failed (HTTP ${response.status})`;
      try {
        const body = await response.text();
        if (body) errorMsg = `Export failed: ${body}`;
      } catch {
        // body vacío o no legible
      }
      throw new Error(errorMsg);
    }

    return response.blob();
  },

  /**
   * Crea un .jwlibrary desde cero (sin archivo original).
   * Devuelve el ZIP como Blob.
   */
  async exportNew(request: ExportRequestDTO): Promise<Blob> {
    const formData = new FormData();
    formData.append("request_json", JSON.stringify(request));

    const response = await fetch(`${API_BASE}/api/interop/export-new`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Export failed (HTTP ${response.status})`;
      try {
        const body = await response.text();
        if (body) errorMsg = `Export failed: ${body}`;
      } catch {
        // body vacío o no legible
      }
      throw new Error(errorMsg);
    }

    return response.blob();
  },

  /** Descarga un Blob como archivo en el navegador. */
  downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
