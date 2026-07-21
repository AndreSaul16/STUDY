/**
 * JWPUBClient — cliente HTTP para los endpoints de publicaciones .jwpub.
 *
 * Conecta con el backend FastAPI en /api/jwpub/*.
 * Maneja upload de archivos .jwpub (multipart) y recepción de documentos.
 */

import { API_BASE } from "@/services/apiBase";

export interface JWPUBDocument {
  DocumentId: number;
  Title: string;
  Content: string;
  ContentLength: number;
}

export interface JWPUBTOCItem {
  Id: number;
  ParentId: number;
  Title: string;
  DocumentId: number;
}

export interface JWPUBPublication {
  symbol: string;
  title: string;
  year: number;
  language: number;
  issueTagNumber: number;
  publicationType: string;
  categories: string[];
}

export interface JWPUBImportResult {
  success: boolean;
  publication: JWPUBPublication;
  documentCount: number;
  documents: JWPUBDocument[];
  toc: JWPUBTOCItem[];
  errors: string[];
}

export interface JWPUBListEntry {
  symbol: string;
  title: string;
  year: number;
  language: number;
  documentCount: number;
}

export const jwpubClient = {
  /**
   * Sube un archivo .jwpub, lo desencripta en el backend y devuelve
   * la estructura completa: metadata + documentos + TOC.
   */
  async upload(file: File): Promise<JWPUBImportResult> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/jwpub/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Upload failed (HTTP ${response.status})`;
      try {
        const body = await response.text();
        if (body) errorMsg = `Upload failed: ${body}`;
      } catch {
        // body vacío
      }
      throw new Error(errorMsg);
    }

    return response.json();
  },

  /** Lista las publicaciones cargadas en el backend. */
  async list(): Promise<JWPUBListEntry[]> {
    const response = await fetch(`${API_BASE}/api/jwpub/list`);
    if (!response.ok) throw new Error(`List failed: ${response.status}`);
    const data = await response.json();
    return data.publications;
  },

  /** Obtiene una publicación completa con todos sus documentos. */
  async getPublication(symbol: string): Promise<{
    publication: JWPUBPublication;
    documents: JWPUBDocument[];
    toc: JWPUBTOCItem[];
  }> {
    const response = await fetch(`${API_BASE}/api/jwpub/${encodeURIComponent(symbol)}`);
    if (!response.ok) throw new Error(`Get failed: ${response.status}`);
    return response.json();
  },

  /** Obtiene un documento específico de una publicación. */
  async getDocument(symbol: string, docId: number): Promise<{
    publication: JWPUBPublication;
    document: JWPUBDocument;
  }> {
    const response = await fetch(
      `${API_BASE}/api/jwpub/${encodeURIComponent(symbol)}/doc/${docId}`,
    );
    if (!response.ok) throw new Error(`Get document failed: ${response.status}`);
    return response.json();
  },
};
