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
import { LOCAL_DB_SCHEMA_BASE, LOCAL_DB_SCHEMA_FTS5 } from "@/db/schema";

const INDEXED_DB_NAME = "study-workspace";
const INDEXED_DB_STORE = "sqlite";
const INDEXED_DB_KEY = "database";
const SQL_WASM_PATH = "/sql-wasm.wasm"; // Servido desde /public

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
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

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // Cargar sql.js WASM
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => SQL_WASM_PATH,
    });
  }

  // Intentar restaurar desde IndexedDB
  const savedBytes = await loadFromIndexedDB();
  if (savedBytes && savedBytes.length > 0) {
    db = new SQL.Database(savedBytes);
    // Verificar que el esquema está aplicado
    ensureSchema(db);
  } else {
    // Crear DB nueva
    db = new SQL.Database();
    applySchema(db);
  }

  return db;
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
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
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
  stmt.bind(params);
  stmt.step();
  stmt.free();
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
      stmt.bind(params);
      stmt.step();
      stmt.free();
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
