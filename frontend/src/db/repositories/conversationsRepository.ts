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

import { queryAll, queryOne, execute, executeTransaction } from "@/db/database";
import type { ChatMessageMeta, ChatSource, ToolActivity } from "@/types/chat";

export interface ConversationRow {
  conversationId: string;
  title: string;
  mode: string;
  pinned: boolean;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

/** Crea una conversación vacía y devuelve su id. */
export function createConversation(mode: string): string {
  const conversationId = genId("conv");
  execute(
    `INSERT INTO conversations (conversation_id, title, mode) VALUES (?, ?, ?)`,
    [conversationId, UNTITLED_CONVERSATION, mode],
  );
  return conversationId;
}

/** Las fijadas primero; dentro de cada grupo, las más recientes arriba. */
export function listConversations(limit = 50): ConversationRow[] {
  return queryAll<RawConversation>(
    `SELECT * FROM conversations
     ORDER BY pinned DESC, updated_at DESC
     LIMIT ?`,
    [limit],
  ).map(toConversation);
}

/** Busca por título y por contenido de los mensajes (LIKE, sin FTS5). */
export function searchConversations(q: string, limit = 30): ConversationRow[] {
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
 */
export function pruneEmptyConversations(keepId?: string): void {
  const vacias = `
    SELECT c.conversation_id FROM conversations c
    WHERE c.conversation_id <> COALESCE(?, '')
      AND NOT EXISTS (
            SELECT 1 FROM chat_messages m
            WHERE m.conversation_id = c.conversation_id
          )`;

  executeTransaction([
    {
      sql: `DELETE FROM chat_images WHERE conversation_id IN (${vacias})`,
      params: [keepId ?? null],
    },
    {
      sql: `DELETE FROM conversations WHERE conversation_id IN (${vacias})`,
      params: [keepId ?? null],
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
