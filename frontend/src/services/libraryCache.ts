/**
 * libraryCache — biblioteca .jwpub persistida en el navegador (IndexedDB).
 *
 * El backend cachea las publicaciones subidas en un LRU **en memoria del
 * proceso**: se vacía al refrescar la pestaña sólo a medias (el estado de React
 * se pierde) y del todo cuando el contenedor se reinicia o se redespliega. Es
 * decir, el usuario subía su libro y al volver al día siguiente ya no estaba.
 *
 * Guardando la publicación en el propio navegador, la biblioteca es del
 * usuario y sobrevive a cualquier cosa que le pase al servidor. El backend
 * pasa a ser lo que debe ser: el que desencripta el .jwpub, no su almacén.
 *
 * Se usa una base IndexedDB aparte de la de sql.js: los documentos son HTML
 * grande y no queremos inflar el blob de la base de datos, que se reserializa
 * entera en cada guardado.
 */

import type {
  JWPUBDocument,
  JWPUBPublication,
  JWPUBTOCItem,
} from "@/services/jwpubClient";

const DB_NAME = "study-library";
const DB_VERSION = 1;
const STORE = "publications";

export interface StoredPublication {
  /** Clave primaria: el símbolo de la publicación (ej. "bt", "w06"). */
  symbol: string;
  publication: JWPUBPublication;
  documents: JWPUBDocument[];
  toc: JWPUBTOCItem[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "symbol" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda (o reemplaza) una publicación.
 *
 * No lanza: que falle el guardado —cuota agotada, modo privado— no debe
 * impedir leer la publicación que se acaba de subir.
 */
export async function savePublication(
  publication: JWPUBPublication,
  documents: JWPUBDocument[],
  toc: JWPUBTOCItem[],
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const entry: StoredPublication = {
      symbol: publication.symbol,
      publication,
      documents,
      toc,
      savedAt: Date.now(),
    };
    tx.objectStore(STORE).put(entry);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn("[library] no se pudo guardar la publicación:", error);
  }
}

/** Todas las publicaciones guardadas, de la más reciente a la más antigua. */
export async function listPublications(): Promise<StoredPublication[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = await promisify(
      tx.objectStore(STORE).getAll() as IDBRequest<StoredPublication[]>,
    );
    db.close();
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch (error) {
    console.warn("[library] no se pudo leer la biblioteca local:", error);
    return [];
  }
}

/** Una publicación concreta, o null si no está guardada. */
export async function getPublication(
  symbol: string,
): Promise<StoredPublication | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const found = await promisify(
      tx.objectStore(STORE).get(symbol) as IDBRequest<StoredPublication | undefined>,
    );
    db.close();
    return found ?? null;
  } catch (error) {
    console.warn("[library] no se pudo leer la publicación:", error);
    return null;
  }
}

/** Borra una publicación de la biblioteca local. */
export async function deletePublication(symbol: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(symbol);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch (error) {
    console.warn("[library] no se pudo borrar la publicación:", error);
  }
}
