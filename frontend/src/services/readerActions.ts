/**
 * readerActions — abrir contenido en el lector, venga de donde venga.
 *
 * Un único punto de entrada para «abrir algo»: se encarga del estado de carga,
 * de los errores y de normalizar la fuente a un `Article`. Los componentes sólo
 * llaman a `openBibleChapter(...)` y se despreocupan.
 *
 * Son funciones sueltas (no un hook) a propósito: se invocan desde manejadores
 * de eventos, desde el arranque de la app y desde los resolvers de referencias,
 * donde no siempre hay un componente React alrededor.
 */

import { useReaderStore } from "@/store/readerStore";
import type { ReadingSource } from "@/store/readerStore";
import { useLibraryStore } from "@/store/libraryStore";
import { fetchChapter } from "@/services/bibleClient";
import { fetchDocument } from "@/services/referenceClient";
import { getDailyText } from "@/services/jwDailyClient";
import { jwpubClient } from "@/services/jwpubClient";
import { getPublication as getStoredPublication } from "@/services/libraryCache";
import { jwpubDocumentToArticle } from "@/utils/htmlToBlocks";
import {
  bibleChapterToArticle,
  dailyTextToArticle,
  wolDocumentToArticle,
} from "@/utils/toArticle";

function describe(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Envuelve una carga: marca cargando, y si falla deja el error en el store en
 * vez de propagar una excepción a un manejador de eventos que nadie captura.
 */
async function load(run: () => Promise<void>, fallbackMessage: string): Promise<void> {
  const { setLoading, setError } = useReaderStore.getState();
  setLoading(true);
  try {
    await run();
  } catch (error) {
    setError(describe(error, fallbackMessage));
  }
}

/**
 * Precarga los capítulos contiguos, sin bloquear ni molestar.
 *
 * Leyendo la Biblia se pulsa ← y → constantemente, así que el acierto es
 * altísimo con solo dos peticiones. Se hace en segundo plano y los fallos se
 * ignoran: es una mejora de comodidad, no una operación necesaria.
 *
 * Deliberadamente NO se precarga en masa. Bajar la Biblia entera son 1.189
 * capítulos y horas de peticiones seguidas contra wol.jw.org: eso deja de ser
 * caché para convertirse en scraping, con el riesgo de bloqueo que conlleva.
 * Como la caché del backend es compartida, además, basta con que un capítulo
 * se pida una vez desde cualquier dispositivo.
 */
function prefetchNeighbours(book: string, chapter: number): void {
  for (const target of [chapter + 1, chapter - 1]) {
    if (target < 1) continue;
    void fetchChapter(book, target).catch(() => {
      // Un capítulo que no existe (pasado el final del libro) o un fallo de
      // red no son un problema: solo significa que no habrá adelanto.
    });
  }
}

/** Abre un capítulo de la Biblia. */
export function openBibleChapter(book: string, chapter: number): Promise<void> {
  return load(async () => {
    const data = await fetchChapter(book, chapter);
    useReaderStore
      .getState()
      .setArticle(bibleChapterToArticle(data), {
        kind: "bible",
        book: data.book_name,
        chapter: data.chapter,
      });

    prefetchNeighbours(data.book_name, data.chapter);
  }, "No se pudo abrir el capítulo");
}

/** Abre un artículo de la Biblioteca en Línea por su doc_id. */
export function openWolDocument(docId: number): Promise<void> {
  return load(async () => {
    const doc = await fetchDocument(docId);
    useReaderStore
      .getState()
      .setArticle(wolDocumentToArticle(doc), { kind: "wol", docId });
  }, "No se pudo abrir el documento");
}

/** Abre el texto del día como lectura completa. */
export function openDailyText(dateIso?: string): Promise<void> {
  return load(async () => {
    const daily = await getDailyText(dateIso);
    useReaderStore
      .getState()
      .setArticle(dailyTextToArticle(daily), {
        kind: "daily",
        dateIso: daily.date_iso,
      });
  }, "No se pudo abrir el texto del día");
}

/**
 * Abre un documento de la publicación .jwpub activa.
 *
 * Si no está en memoria (recarga de página, o al retomar la última lectura),
 * se rehidrata: primero desde la biblioteca local del navegador, y sólo si no
 * está ahí se le pide al backend, cuya caché es volátil.
 */
export function openJwpubDocument(
  documentIndex: number,
  symbol?: string,
): Promise<void> {
  return load(async () => {
    const library = useLibraryStore.getState();
    let documents = library.documents;
    let activeSymbol = symbol ?? library.activePublication?.symbol;

    if (documents.length === 0 && activeSymbol) {
      const stored = await getStoredPublication(activeSymbol);
      const pub = stored ?? (await jwpubClient.getPublication(activeSymbol));

      useLibraryStore
        .getState()
        .loadPublication(pub.publication, pub.documents, pub.toc);
      documents = pub.documents;
      activeSymbol = pub.publication.symbol;
    }

    const doc = documents[documentIndex];
    if (!doc) {
      throw new Error("Ese documento ya no está disponible");
    }

    useLibraryStore.getState().setActiveDocument(documentIndex);
    useReaderStore
      .getState()
      .setArticle(jwpubDocumentToArticle(doc, activeSymbol), {
        kind: "jwpub",
        symbol: activeSymbol ?? "",
        documentIndex,
      });
  }, "No se pudo abrir el documento");
}

/**
 * Abre un documento de la biblioteca local por su `DocumentId`.
 *
 * `openJwpubDocument` trabaja con el ÍNDICE dentro del array `documents`, que
 * es un detalle interno; lo que viaja en las fuentes del chat es el
 * `DocumentId`, que es lo estable. Aquí se traduce lo uno en lo otro.
 *
 * La publicación se carga en el store ANTES de delegar, y no es redundante:
 * `openJwpubDocument` solo rehidrata cuando NO hay ninguna cargada, así que con
 * otro libro abierto interpretaría el índice contra los documentos del libro
 * equivocado y abriría cualquier cosa.
 */
export async function openLocalJwpubDocument(
  symbol: string,
  documentId: number,
): Promise<void> {
  const stored = await getStoredPublication(symbol);
  if (!stored) {
    useReaderStore.getState().setError("Esa publicación ya no está en tu biblioteca");
    return;
  }

  const index = stored.documents.findIndex((d) => d.DocumentId === documentId);
  if (index === -1) {
    useReaderStore.getState().setError("Ese documento ya no está disponible");
    return;
  }

  useLibraryStore
    .getState()
    .loadPublication(stored.publication, stored.documents, stored.toc);
  await openJwpubDocument(index, symbol);
}

/** Reabre una fuente cualquiera (usado al retomar la última lectura). */
export function openSource(source: ReadingSource): Promise<void> {
  switch (source.kind) {
    case "bible":
      return openBibleChapter(source.book, source.chapter);
    case "wol":
      return openWolDocument(source.docId);
    case "daily":
      // Sin fecha: el texto del día de HOY, no el del día que se guardó.
      return openDailyText();
    case "jwpub":
      return openJwpubDocument(source.documentIndex, source.symbol);
  }
}

/** Retoma la última lectura, si la hay. */
export function resumeLastRead(): Promise<void> {
  const { lastRead } = useReaderStore.getState();
  if (!lastRead) return Promise.resolve();
  return openSource(lastRead.source);
}

/**
 * Navega al capítulo anterior/siguiente del libro que se está leyendo.
 * Devuelve false si la lectura actual no es bíblica o no hay a dónde ir.
 */
export function stepChapter(delta: number): boolean {
  const { source } = useReaderStore.getState();
  if (source?.kind !== "bible") return false;

  const target = source.chapter + delta;
  if (target < 1) return false;

  void openBibleChapter(source.book, target);
  return true;
}
