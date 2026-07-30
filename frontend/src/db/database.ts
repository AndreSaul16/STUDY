/**
 * Database — inicialización de SQLite WASM (sql.js) con persistencia
 * en IndexedDB.
 *
 * sql.js compila SQLite a WebAssembly. La DB vive en memoria mientras
 * la app está abierta. Para persistir entre sesiones, serializamos
 * los bytes a IndexedDB (más robusto que localStorage para blobs grandes).
 *
 * Flujo:
 *  1. initDatabase() — carga sql.js, restaura DB desde IndexedDB o crea nueva.
 *  2. Las operaciones usan el singleton `db` (SQL.Database).
 *  3. saveDatabase() — serializa a bytes y guarda en IndexedDB.
 *  4. Auto-save con debounce tras cada escritura.
 */

import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import {
  LOCAL_DB_SCHEMA_BASE,
  LOCAL_DB_SCHEMA_CHAT,
  LOCAL_DB_SCHEMA_FTS5,
  LOCAL_DB_SCHEMA_IMAGES,
} from "@/db/schema";

const INDEXED_DB_NAME = "study-workspace";
const INDEXED_DB_STORE = "sqlite";
const INDEXED_DB_KEY = "database";
const SQL_WASM_PATH = "/sql-wasm.wasm"; // Servido desde /public

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let fts5Available = false; // Cache: resultado de detección de FTS5

/** ¿El motor SQLite soporta FTS5? (sql.js estándar NO lo trae) */
export function isFTS5Available(): boolean {
  return fts5Available;
}

/** Detecta si FTS5 está compilado en el motor SQLite actual. */
function detectFTS5(database: Database): boolean {
  try {
    // Crear tabla virtual temporal y destruiría — si falla, no hay FTS5
    database.exec("CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(x)");
    database.exec("DROP TABLE IF EXISTS __fts5_probe");
    return true;
  } catch {
    return false;
  }
}

/**
 * Aplica el schema base (tablas normales) + FTS5 si está soportado.
 * Es idempotente (usa IF NOT EXISTS en todas las sentencias).
 */
function applySchema(database: Database): void {
  // 1. Schema base — siempre aplicable
  database.exec(LOCAL_DB_SCHEMA_BASE);
  migratePublicationScopes(database);
  migrateChatTables(database);
  migrateImageTables(database);

  // 2. Detectar FTS5 y aplicar schema FTS solo si está soportado
  fts5Available = detectFTS5(database);
  if (fts5Available) {
    try {
      database.exec(LOCAL_DB_SCHEMA_FTS5);
    } catch (e) {
      console.warn("[db] FTS5 detectado pero falló al aplicar schema FTS:", e);
      fts5Available = false;
    }
  } else {
    console.info("[db] FTS5 no disponible — usando fallback LIKE para búsqueda");
  }
}

/** Migra instalaciones v1 sin descartar las anotaciones existentes. */
function migratePublicationScopes(database: Database): void {
  const markColumns = database.exec("PRAGMA table_info(user_marks)")[0]?.values ?? [];
  if (!markColumns.some((column) => column[1] === "publication_key")) {
    database.exec("ALTER TABLE user_marks ADD COLUMN publication_key TEXT NOT NULL DEFAULT 'legacy'");
  }
  for (const column of ["start_token", "end_token", "token_count"]) {
    if (!markColumns.some((existing) => existing[1] === column)) {
      database.exec(`ALTER TABLE user_marks ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  }
  const noteColumns = database.exec("PRAGMA table_info(notes)")[0]?.values ?? [];
  if (!noteColumns.some((column) => column[1] === "publication_key")) {
    database.exec("ALTER TABLE notes ADD COLUMN publication_key TEXT NOT NULL DEFAULT 'legacy'");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_marks_publication_document ON user_marks(publication_key, document_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_notes_publication_document ON notes(publication_key, document_id)");
  database.exec("INSERT OR IGNORE INTO schema_version (version) VALUES (2)");
}

/**
 * Migra a la v3 — tablas del chat sobre bases v2 ya existentes.
 *
 * Idempotente (todo con IF NOT EXISTS) y aditiva: no toca ni una tabla
 * anterior, así que no puede perder anotaciones ni notas.
 */
function migrateChatTables(database: Database): void {
  database.exec(LOCAL_DB_SCHEMA_CHAT);
}

/**
 * Migra a la v4 — ilustraciones generadas y metadatos del mensaje.
 *
 * Mismo patrón que las anteriores: aditiva, idempotente y sin un solo DROP.
 * La columna `meta_json` va con la guarda de PRAGMA table_info porque SQLite
 * no tiene `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y un ALTER repetido
 * lanza.
 */
function migrateImageTables(database: Database): void {
  database.exec(LOCAL_DB_SCHEMA_IMAGES);

  const columns = database.exec("PRAGMA table_info(chat_messages)")[0]?.values ?? [];
  if (!columns.some((column) => column[1] === "meta_json")) {
    database.exec("ALTER TABLE chat_messages ADD COLUMN meta_json TEXT");
  }
}

// ─── IndexedDB helpers ───────────────────────────────────────────

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(INDEXED_DB_STORE)) {
        idb.createObjectStore(INDEXED_DB_STORE);
      }
    };
  });
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(INDEXED_DB_STORE, "readonly");
      const req = tx.objectStore(INDEXED_DB_STORE).get(INDEXED_DB_KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result ?? null);
    });
  } catch {
    return null;
  }
}

async function saveToIndexedDB(bytes: Uint8Array): Promise<void> {
  try {
    const idb = await openIndexedDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(INDEXED_DB_STORE, "readwrite");
      tx.objectStore(INDEXED_DB_STORE).put(bytes, INDEXED_DB_KEY);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  } catch (e) {
    console.error("[db] Failed to save to IndexedDB:", e);
  }
}

// ─── Inicialización ──────────────────────────────────────────────

export function initDatabase(): Promise<Database> {
  if (db) return Promise.resolve(db);
  // Memoizar la promesa: llamadas concurrentes comparten la misma init
  // (evita crear dos SQL.Database en paralelo).
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Cargar sql.js WASM
    if (!SQL) {
      SQL = await initSqlJs({
        locateFile: () => SQL_WASM_PATH,
      });
    }

    // Intentar restaurar desde IndexedDB
    const savedBytes = await loadFromIndexedDB();
    let database: Database;
    if (savedBytes && savedBytes.length > 0) {
      database = new SQL.Database(savedBytes);
      // Verificar que el esquema está aplicado
      ensureSchema(database);
    } else {
      // Crear DB nueva
      database = new SQL.Database();
      applySchema(database);
    }

    db = database;
    return database;
  })();

  // Si falla, resetear la promesa para permitir reintento
  initPromise.catch(() => {
    initPromise = null;
  });

  return initPromise;
}

function ensureSchema(database: Database): void {
  // Verificar si la tabla schema_version existe
  const result = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
  );
  if (result.length === 0) {
    // Esquema no aplicado — aplicar todo (con detección FTS5)
    applySchema(database);
  } else {
    migratePublicationScopes(database);
    migrateChatTables(database);
    migrateImageTables(database);
    // Schema base ya aplicado — pero re-detectar FTS5 por si la DB
    // fue creada con un motor distinto al actual
    fts5Available = detectFTS5(database);
    if (fts5Available) {
      try {
        database.exec(LOCAL_DB_SCHEMA_FTS5);
      } catch {
        fts5Available = false;
      }
    }
  }
}

// ─── Acceso al singleton ─────────────────────────────────────────

export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

// ─── Persistencia ────────────────────────────────────────────────

export async function saveDatabase(): Promise<void> {
  if (!db) return;
  const bytes = db.export();
  await saveToIndexedDB(bytes);
}

/** Debounced save — evita escribir a IndexedDB en cada operación. */
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveDatabase();
  }, 500);
}

/**
 * Fuerza el guardado pendiente inmediatamente (cancela el debounce).
 * Se llama al ocultar/cerrar la pestaña para no perder cambios recientes.
 */
export async function flushPendingSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await saveDatabase();
}

// Guardar cambios pendientes cuando la pestaña se oculta o se cierra.
if (typeof window !== "undefined") {
  const flush = () => {
    void flushPendingSave();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

// ─── Helpers de query ────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  values: unknown[][];
}

/** Ejecuta un SELECT y devuelve filas como objetos. */
export function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

/** Ejecuta un SELECT y devuelve la primera fila o null. */
export function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
): T | null {
  const rows = queryAll<T>(sql, params);
  return rows[0] ?? null;
}

/** Ejecuta un INSERT/UPDATE/DELETE y guarda con debounce. */
export function execute(
  sql: string,
  params: SqlValue[] = [],
): void {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }
  scheduleSave();
}

/** Ejecuta múltiples sentencias en una transacción. */
export function executeTransaction(
  statements: Array<{ sql: string; params: SqlValue[] }>,
): void {
  const database = getDatabase();
  database.exec("BEGIN TRANSACTION");
  try {
    for (const { sql, params } of statements) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(params);
        stmt.step();
      } finally {
        stmt.free();
      }
    }
    database.exec("COMMIT");
    scheduleSave();
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}

// ─── Export/Import de la DB ──────────────────────────────────────

/** Exporta la DB completa como bytes (para descarga de backup). */
export function exportDatabase(): Uint8Array {
  return getDatabase().export();
}

/** Importa una DB desde bytes (reemplaza la actual). */
export async function importDatabase(bytes: Uint8Array): Promise<void> {
  if (db) {
    db.close();
  }
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => SQL_WASM_PATH });
  }
  db = new SQL.Database(bytes);
  await saveDatabase();
}

/** Resetea la DB a estado vacío. */
export async function resetDatabase(): Promise<void> {
  if (db) {
    db.close();
  }
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => SQL_WASM_PATH });
  }
  db = new SQL.Database();
  applySchema(db);
  await saveDatabase();
}
