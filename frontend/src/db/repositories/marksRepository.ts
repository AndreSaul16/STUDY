/**
 * MarksRepository — CRUD para marcas de subrayado multi-color.
 */

import { queryAll, queryOne, execute } from "@/db/database";

export interface MarkRow {
  mark_id: string;
  document_id: number;
  publication_key: string;
  block_id: number;
  color: string;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  start_token: number;
  end_token: number;
  token_count: number;
  created_at: number;
}

const genId = () =>
  `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const marksRepository = {
  create(params: {
    documentId: number;
    publicationKey: string;
    blockId: number;
    color: string;
    startOffset: number;
    endOffset: number;
    selectedText: string;
    startToken: number;
    endToken: number;
    tokenCount: number;
  }): string {
    const markId = genId();
    execute(
      `INSERT INTO user_marks
       (mark_id, document_id, publication_key, block_id, color, start_offset, end_offset, selected_text, start_token, end_token, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        markId,
        params.documentId,
        params.publicationKey,
        params.blockId,
        params.color,
        params.startOffset,
        params.endOffset,
        params.selectedText,
        params.startToken,
        params.endToken,
        params.tokenCount,
      ],
    );
    return markId;
  },

  updateColor(markId: string, color: string): void {
    execute(`UPDATE user_marks SET color = ? WHERE mark_id = ?`, [color, markId]);
  },

  delete(markId: string): void {
    execute(`DELETE FROM user_marks WHERE mark_id = ?`, [markId]);
  },

  getById(markId: string): MarkRow | null {
    return queryOne<MarkRow>(`SELECT * FROM user_marks WHERE mark_id = ?`, [markId]);
  },

  getByBlock(blockId: number): MarkRow[] {
    return queryAll<MarkRow>(
      `SELECT * FROM user_marks WHERE block_id = ? ORDER BY start_offset`,
      [blockId],
    );
  },

  getByDocument(publicationKey: string, documentId: number): MarkRow[] {
    return queryAll<MarkRow>(
      `SELECT * FROM user_marks WHERE publication_key = ? AND document_id = ? ORDER BY block_id, start_offset`,
      [publicationKey, documentId],
    );
  },

  getAll(): MarkRow[] {
    return queryAll<MarkRow>(`SELECT * FROM user_marks ORDER BY created_at, mark_id`);
  },

  count(): number {
    const row = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM user_marks`,
    );
    return row?.count ?? 0;
  },
};
