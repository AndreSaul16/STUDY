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

/**
 * Dónde vive una anotación en los términos de JW Library (tabla `Location`).
 * Una de las dos formas: capítulo bíblico o publicación.
 */
export interface ExportLocationDTO {
  /** Publicación: es el mismo docId de wol.jw.org. */
  document_id?: number;
  key_symbol?: string;
  issue_tag_number?: number;
  /** Capítulo bíblico. */
  book_number?: number;
  chapter_number?: number;
  /** 1 = español. */
  meps_language?: number;
  location_type?: number;
  title?: string;
}

export interface ExportRangeDTO {
  /** Nº de párrafo (data-pid) o de versículo. No es un índice nuestro. */
  identifier: number;
  /** 1 = párrafo, 2 = versículo. */
  block_type: number;
  /**
   * Índices de la tokenización interna de JW Library. Se omiten mientras no
   * se conozca esa tokenización: inventarlos colocaría el subrayado sobre
   * palabras equivocadas.
   */
  start_token?: number | null;
  end_token?: number | null;
}

export interface ExportNoteDTO {
  /** Guid estable: reexportar actualiza la nota en vez de duplicarla. */
  guid?: string;
  title: string;
  content: string;
  last_modified?: string;
  created?: string;
}

export interface ExportMarkDTO {
  local_id: string;
  /** UserMarkGuid estable — clave de la fusión. */
  guid?: string;
  location: ExportLocationDTO;
  /** ColorIndex 1-9. */
  color: number;
  style?: number;
  ranges: ExportRangeDTO[];
  note?: ExportNoteDTO;
}

export interface ExportRequestDTO {
  marks: ExportMarkDTO[];
  /** En el esquema real Tag es (Type, Name); no lleva color. */
  tags: { name: string; tag_type?: number }[];
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
