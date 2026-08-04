/**
 * ConversationsRepository — historial del chat en el SQLite local.
 *
 * El historial es del usuario y vive en su navegador: la app no tiene
 * autenticación y el contenedor de Railway tiene filesystem efímero, así que
 * un historial en el backend sería compartido y se borraría en cada deploy.
 *
 * Búsqueda con LIKE, no con FTS5: sql.js estándar no trae FTS5 (ver
 * searchRepository.ts, que ya usa este mismo fallback).
 */

import {
  queryAll,
  queryOne,
  execute,
  executeTransaction,
  getDatabase,
} from "@/db/database";
import { CONVERSATION_AI_COLUMNS } from "@/db/schema";
import type {
  ChatMessageMeta,
  ChatSource,
  ConversationAi,
  ToolActivity,
} from "@/types/chat";

export interface ConversationRow {
  conversationId: string;
  title: string;
  mode: string;
  pinned: boolean;
  /**
   * Con qué responde esta conversación (columnas v5). Los tres a `null` en las
   * conversaciones creadas antes de que esto existiera: significan «usa el
   * ajuste global» y así siguen abriéndose sin tocar nada.
   */
  ai: ConversationAi;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRow {
  messageId: string;
  conversationId: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  mode: string | null;
  sources: ChatSource[];
  tools: ToolActivity[];
  suggestions: string[];
  /** Proveedor, modelo y esfuerzo con los que se generó (columna v4). */
  meta?: ChatMessageMeta;
  createdAt: number;
}

/** Título de una conversación recién creada. Marca "aún sin renombrar". */
export const UNTITLED_CONVERSATION = "Conversación nueva";

interface RawConversation {
  conversation_id: string;
  title: string;
  mode: string;
  pinned: number;
  /** Opcionales: una base sin migrar todavía no trae estas columnas. */
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  created_at: number;
  updated_at: number;
}

interface RawChatMessage {
  message_id: string;
  conversation_id: string;
  seq: number;
  role: string;
  content: string;
  mode: string | null;
  sources_json: string;
  tools_json: string;
  suggestions_json: string;
  meta_json?: string | null;
  created_at: number;
}

const genId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** JSON del que no nos fiamos: una fila corrupta no puede tumbar el chat. */
function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toConversation(row: RawConversation): ConversationRow {
  return {
    conversationId: row.conversation_id,
    title: row.title,
    mode: row.mode,
    pinned: row.pinned === 1,
    // Cadena vacía → null: en la base «sin modelo» y «modelo por defecto» son
    // lo mismo, y arrastrar el "" hasta la petición mandaría un modelo vacío.
    ai: {
      provider: row.provider || null,
      model: row.model || null,
      effort: row.effort || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Migración v5, en el repositorio ─────────────────────────────

/**
 * La base sobre la que ya se comprobaron las columnas del modelo.
 *
 * Se guarda la INSTANCIA y no un booleano porque `importDatabase` sustituye el
 * objeto entero al restaurar una copia de seguridad: con una bandera, la base
 * recién importada —que puede ser de hace meses— se daría por migrada y el
 * primer `UPDATE ... SET provider` reventaría con «no such column».
 */
let aiColumnsCheckedOn: ReturnType<typeof getDatabase> | null = null;

/**
 * Añade las columnas `provider`/`model`/`effort` si faltan.
 *
 * Con `exec` directo y no con `execute()` porque es DDL y sigue el mismo camino
 * que las migraciones de `database.ts`, que es el que está probado contra
 * sql.js. Se llama al principio de todo lo que lee o escribe la tabla: después
 * de la primera vez cuesta una comparación de punteros.
 */
function ensureConversationAiColumns(): void {
  const database = getDatabase();
  if (aiColumnsCheckedOn === database) return;

  const existing = new Set(
    (database.exec("PRAGMA table_info(conversations)")[0]?.values ?? []).map(
      (column) => String(column[1]),
    ),
  );
  for (const column of CONVERSATION_AI_COLUMNS) {
    if (!existing.has(column.name)) database.exec(column.sql);
  }
  database.exec("INSERT OR IGNORE INTO schema_version (version) VALUES (5)");

  aiColumnsCheckedOn = database;
}

/** Igual que `parseJsonArray`, pero para el objeto de metadatos. */
function parseJsonObject<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : undefined;
  } catch {
    return undefined;
  }
}

function toMessage(row: RawChatMessage): ChatMessageRow {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    seq: row.seq,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    mode: row.mode,
    sources: parseJsonArray<ChatSource>(row.sources_json),
    tools: parseJsonArray<ToolActivity>(row.tools_json),
    suggestions: parseJsonArray<string>(row.suggestions_json),
    meta: parseJsonObject<ChatMessageMeta>(row.meta_json),
    createdAt: row.created_at,
  };
}

/**
 * Crea una conversación vacía y devuelve su id.
 *
 * El modelo se fija AL CREARLA, copiando el ajuste global de ese momento, en
 * vez de dejarlo a null y resolverlo al enviar. Así la conversación recuerda de
 * verdad con qué se abrió: si mañana el usuario cambia su modelo por defecto,
 * los chats de hoy siguen respondiendo con el suyo. Sin `ai` (o con sus campos
 * a null) se comporta como antes y hereda el global.
 */
export function createConversation(mode: string, ai?: ConversationAi): string {
  ensureConversationAiColumns();
  const conversationId = genId("conv");
  execute(
    `INSERT INTO conversations (conversation_id, title, mode, provider, model, effort)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      UNTITLED_CONVERSATION,
      mode,
      ai?.provider ?? null,
      ai?.model ?? null,
      ai?.effort ?? null,
    ],
  );
  return conversationId;
}

/** Las fijadas primero; dentro de cada grupo, las más recientes arriba. */
export function listConversations(limit = 50): ConversationRow[] {
  ensureConversationAiColumns();
  return queryAll<RawConversation>(
    `SELECT * FROM conversations
     ORDER BY pinned DESC, updated_at DESC
     LIMIT ?`,
    [limit],
  ).map(toConversation);
}

/** Busca por título y por contenido de los mensajes (LIKE, sin FTS5). */
export function searchConversations(q: string, limit = 30): ConversationRow[] {
  ensureConversationAiColumns();
  const term = q.trim();
  if (!term) return listConversations(limit);

  const like = `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return queryAll<RawConversation>(
    `SELECT c.* FROM conversations c
     WHERE c.title LIKE ? ESCAPE '\\'
        OR EXISTS (
             SELECT 1 FROM chat_messages m
             WHERE m.conversation_id = c.conversation_id
               AND m.content LIKE ? ESCAPE '\\'
           )
     ORDER BY c.pinned DESC, c.updated_at DESC
     LIMIT ?`,
    [like, like, limit],
  ).map(toConversation);
}

export function getConversation(conversationId: string): ConversationRow | null {
  ensureConversationAiColumns();
  const row = queryOne<RawConversation>(
    `SELECT * FROM conversations WHERE conversation_id = ?`,
    [conversationId],
  );
  return row ? toConversation(row) : null;
}

export function loadMessages(conversationId: string): ChatMessageRow[] {
  return queryAll<RawChatMessage>(
    `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY seq ASC`,
    [conversationId],
  ).map(toMessage);
}

/**
 * Añade un mensaje al final de la conversación y le sube el `updated_at`.
 *
 * En una sola transacción a propósito: si el mensaje entrara sin tocar la
 * conversación, el cajón lateral la ordenaría como si no hubiera pasado nada.
 */
export function appendMessage(
  msg: Omit<ChatMessageRow, "seq" | "createdAt">,
): void {
  const next = queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM chat_messages WHERE conversation_id = ?`,
    [msg.conversationId],
  );

  executeTransaction([
    {
      sql: `INSERT INTO chat_messages
              (message_id, conversation_id, seq, role, content, mode,
               sources_json, tools_json, suggestions_json, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        msg.messageId,
        msg.conversationId,
        next?.next ?? 1,
        msg.role,
        msg.content,
        msg.mode ?? null,
        JSON.stringify(msg.sources ?? []),
        JSON.stringify(msg.tools ?? []),
        JSON.stringify(msg.suggestions ?? []),
        msg.meta ? JSON.stringify(msg.meta) : null,
      ],
    },
    {
      sql: `UPDATE conversations SET updated_at = strftime('%s','now')
            WHERE conversation_id = ?`,
      params: [msg.conversationId],
    },
  ]);
}

export function renameConversation(conversationId: string, title: string): void {
  const clean = title.trim();
  if (!clean) return;
  execute(`UPDATE conversations SET title = ? WHERE conversation_id = ?`, [
    clean,
    conversationId,
  ]);
}

export function setConversationMode(conversationId: string, mode: string): void {
  execute(`UPDATE conversations SET mode = ? WHERE conversation_id = ?`, [
    mode,
    conversationId,
  ]);
}

/**
 * Fija el proveedor, el modelo y el esfuerzo de UNA conversación.
 *
 * Sin tocar `updated_at`: cambiar de modelo no es actividad de la conversación
 * y, si lo fuera, un toqueteo del selector la subiría al principio del cajón
 * por encima de aquella en la que sí se está hablando.
 */
export function setConversationAi(
  conversationId: string,
  ai: ConversationAi,
): void {
  ensureConversationAiColumns();
  execute(
    `UPDATE conversations SET provider = ?, model = ?, effort = ?
     WHERE conversation_id = ?`,
    [ai.provider, ai.model, ai.effort, conversationId],
  );
}

export function togglePinned(conversationId: string): boolean {
  const row = queryOne<{ pinned: number }>(
    `SELECT pinned FROM conversations WHERE conversation_id = ?`,
    [conversationId],
  );
  if (!row) return false;
  const next = row.pinned === 1 ? 0 : 1;
  execute(`UPDATE conversations SET pinned = ? WHERE conversation_id = ?`, [
    next,
    conversationId,
  ]);
  return next === 1;
}

/**
 * Borra la conversación, sus mensajes y sus ilustraciones.
 *
 * El `ON DELETE CASCADE` no está activo por defecto en sql.js, así que va
 * explícito. Y las imágenes también: cada una son hasta 2 MB de base64 que se
 * quedaban en la base —contando en el medidor de Ajustes y serializándose
 * enteros en cada guardado— sin ninguna conversación desde la que verlos.
 */
export function deleteConversation(conversationId: string): void {
  executeTransaction([
    {
      sql: `DELETE FROM chat_images WHERE conversation_id = ?`,
      params: [conversationId],
    },
    {
      sql: `DELETE FROM chat_messages WHERE conversation_id = ?`,
      params: [conversationId],
    },
    {
      sql: `DELETE FROM conversations WHERE conversation_id = ?`,
      params: [conversationId],
    },
  ]);
}

/**
 * Elimina las conversaciones que se crearon y nunca recibieron un mensaje.
 *
 * "Sin mensajes" no quiere decir "sin nada": una ilustración se puede generar
 * antes de que la respuesta se persista, así que se limpian también.
 *
 * `keepIds` es una LISTA y no un id suelto desde que se pueden tener varios
 * chats abiertos: al arrancar se reabren todas las pestañas de la sesión
 * anterior y cualquiera de ellas puede estar todavía en blanco. Con un solo id
 * se salvaba una y la limpieza se llevaba por delante el resto de pestañas
 * justo antes de restaurarlas.
 */
export function pruneEmptyConversations(keepIds: string[] = []): void {
  // Los placeholders se generan a mano: `IN (?)` con un array no existe en
  // sql.js, hay que expandirlo.
  const keep = keepIds.filter(Boolean);
  const placeholders = keep.map(() => "?").join(", ");
  const vacias = `
    SELECT c.conversation_id FROM conversations c
    WHERE ${keep.length ? `c.conversation_id NOT IN (${placeholders}) AND` : ""}
      NOT EXISTS (
            SELECT 1 FROM chat_messages m
            WHERE m.conversation_id = c.conversation_id
          )`;

  executeTransaction([
    {
      sql: `DELETE FROM chat_images WHERE conversation_id IN (${vacias})`,
      params: keep,
    },
    {
      sql: `DELETE FROM conversations WHERE conversation_id IN (${vacias})`,
      params: keep,
    },
  ]);
}

/** Título automático: las primeras palabras del primer mensaje del usuario. */
export function autoTitle(firstUserMessage: string): string {
  const clean = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!clean) return UNTITLED_CONVERSATION;

  const words = clean.split(" ").slice(0, 6).join(" ");
  return words.length > 48 ? `${words.slice(0, 47).trimEnd()}…` : words;
}

export function newMessageId(): string {
  return genId("msg");
}
