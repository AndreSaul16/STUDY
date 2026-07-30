/**
 * imagesRepository — las ilustraciones generadas, en el SQLite local.
 *
 * Aquí y no en el backend porque el contenedor de Railway tiene filesystem
 * efímero: una imagen "guardada" allí duraría hasta el siguiente deploy.
 *
 * **El riesgo real de esta tabla es el peso.** sql.js mantiene la base entera
 * en RAM y `exportDatabase()` la serializa completa en cada guardado. Un PNG de
 * 1024² en base64 pesa cerca de 2 MB; veinte de esos convierten el guardado
 * automático en un parón perceptible. Por eso: se pide WebP al proveedor, hay
 * un tope duro de imágenes y se purga por antigüedad al insertar.
 *
 * La red de seguridad de verdad, en todo caso, es el botón de descargar: el
 * archivo en Descargas es el respaldo que no depende de nada de esto.
 */

import { execute, executeTransaction, queryAll, queryOne } from "@/db/database";

/** Tope duro. Al insertar la número 25 se borra la más antigua. */
export const MAX_STORED_IMAGES = 24;

export interface ChatImageRow {
  imageId: string;
  conversationId: string;
  messageId: string | null;
  prompt: string;
  provider: string;
  model: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  dataB64: string;
  createdAt: number;
}

interface RawChatImage {
  image_id: string;
  conversation_id: string;
  message_id: string | null;
  prompt: string;
  provider: string;
  model: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  data_b64: string;
  created_at: number;
}

function toImage(row: RawChatImage): ChatImageRow {
  return {
    imageId: row.image_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    dataB64: row.data_b64,
    createdAt: row.created_at,
  };
}

function newImageId(): string {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Guarda una imagen y purga las sobrantes. Devuelve la fila insertada. */
export function saveImage(
  image: Omit<ChatImageRow, "imageId" | "createdAt" | "bytes"> &
    Partial<Pick<ChatImageRow, "imageId" | "bytes">>,
): ChatImageRow {
  const imageId = image.imageId ?? newImageId();
  // El base64 ocupa 4/3 de los bytes reales; sirve para el medidor de Ajustes.
  const bytes = image.bytes ?? Math.round((image.dataB64.length * 3) / 4);

  executeTransaction([
    {
      sql: `INSERT INTO chat_images
              (image_id, conversation_id, message_id, prompt, provider, model,
               mime, width, height, bytes, data_b64)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        imageId,
        image.conversationId,
        image.messageId ?? null,
        image.prompt,
        image.provider,
        image.model,
        image.mime,
        image.width,
        image.height,
        bytes,
        image.dataB64,
      ],
    },
    {
      // Purga LRU por fecha: sin esto la base crece hasta que la app se
      // arrastra, y el usuario no tiene forma de saber por qué.
      sql: `DELETE FROM chat_images
            WHERE image_id NOT IN (
              SELECT image_id FROM chat_images
              ORDER BY created_at DESC LIMIT ?
            )`,
      params: [MAX_STORED_IMAGES],
    },
  ]);

  return {
    ...image,
    imageId,
    bytes,
    messageId: image.messageId ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/** Imágenes de una conversación, las más recientes primero. */
export function listImages(conversationId: string): ChatImageRow[] {
  return queryAll<RawChatImage>(
    `SELECT * FROM chat_images WHERE conversation_id = ? ORDER BY created_at DESC`,
    [conversationId],
  ).map(toImage);
}

/** Imágenes colgadas de un mensaje concreto. */
export function listImagesForMessage(messageId: string): ChatImageRow[] {
  return queryAll<RawChatImage>(
    `SELECT * FROM chat_images WHERE message_id = ? ORDER BY created_at ASC`,
    [messageId],
  ).map(toImage);
}

export function deleteImage(imageId: string): void {
  execute(`DELETE FROM chat_images WHERE image_id = ?`, [imageId]);
}

/** Cuántas hay y cuánto ocupan. Para la fila de Ajustes. */
export function imagesFootprint(): { count: number; bytes: number } {
  const row = queryOne<{ count: number; bytes: number | null }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM chat_images`,
  );
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}

export function clearImages(): void {
  execute(`DELETE FROM chat_images`);
}

/** "1,4 MB" — para el medidor, sin librerías. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
