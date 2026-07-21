/**
 * HistoryRepository — historial de navegación persistente.
 */

import { queryAll, queryOne, execute } from "@/db/database";

export interface HistoryRow {
  entry_id: number;
  document_id: number | null;
  block_id: number | null;
  reference_identifier: string | null;
  action: string;
  visited_at: number;
}

export const historyRepository = {
  add(params: {
    documentId?: number | null;
    blockId?: number | null;
    referenceIdentifier?: string | null;
    action: string;
  }): void {
    execute(
      `INSERT INTO history (document_id, block_id, reference_identifier, action)
       VALUES (?, ?, ?, ?)`,
      [
        params.documentId ?? null,
        params.blockId ?? null,
        params.referenceIdentifier ?? null,
        params.action,
      ],
    );
  },

  getRecent(limit = 50): HistoryRow[] {
    return queryAll<HistoryRow>(
      `SELECT * FROM history ORDER BY visited_at DESC LIMIT ?`,
      [limit],
    );
  },

  getByAction(action: string, limit = 50): HistoryRow[] {
    return queryAll<HistoryRow>(
      `SELECT * FROM history WHERE action = ? ORDER BY visited_at DESC LIMIT ?`,
      [action, limit],
    );
  },

  clear(): void {
    execute(`DELETE FROM history`, []);
  },

  count(): number {
    const row = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM history`);
    return row?.count ?? 0;
  },
};
