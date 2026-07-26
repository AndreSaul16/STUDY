/**
 * bibleClient — lectura de la Biblia en español desde el backend.
 *
 * El backend sirve el texto de la Traducción del Nuevo Mundo obtenido de
 * wol.jw.org (`GET /api/jw/bible/...`). El catálogo de libros es una constante
 * del canon, así que se pide una sola vez y se memoiza en el módulo: la
 * rejilla de capítulos debe pintarse sin esperar a la red.
 */

import { API_BASE } from "@/services/apiBase";

export interface BibleBook {
  number: number;
  name: string;
  chapters: number;
  /** "hebreas" (1-39) o "griegas" (40-66). */
  section: "hebreas" | "griegas";
}

export interface BibleVerse {
  verse: number;
  text: string;
}

export interface BibleChapter {
  book_number: number;
  book_name: string;
  chapter: number;
  title: string;
  source_url: string;
  verses: BibleVerse[];
}

let booksPromise: Promise<BibleBook[]> | null = null;

/** Catálogo de los 66 libros. Memoizado: nunca cambia. */
export function fetchBooks(): Promise<BibleBook[]> {
  if (booksPromise === null) {
    booksPromise = fetch(`${API_BASE}/api/jw/bible/books`)
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar el índice bíblico");
        return response.json();
      })
      .then((data: { books: BibleBook[] }) => data.books)
      .catch((error) => {
        // No dejar cacheada una promesa fallida: el siguiente intento debe
        // volver a pedirlo (p. ej. si el usuario recupera la conexión).
        booksPromise = null;
        throw error;
      });
  }
  return booksPromise;
}

/** Descarga un capítulo completo, versículo a versículo. */
export async function fetchChapter(
  book: string,
  chapter: number,
): Promise<BibleChapter> {
  const response = await fetch(
    `${API_BASE}/api/jw/bible/${encodeURIComponent(book)}/${chapter}`,
  );

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No se encontró ese capítulo"
        : "No se pudo cargar el capítulo",
    );
  }

  return response.json();
}
