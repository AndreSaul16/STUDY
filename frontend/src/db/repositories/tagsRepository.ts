/**
 * TagsRepository — CRUD para etiquetas.
 */

import { queryAll, queryOne, execute } from "@/db/database";

export interface TagRow {
  tag_id: number;
  name: string;
  color: number;
  created_at: number;
}

export const tagsRepository = {
  create(name: string, color: number = 0): number | null {
    try {
      execute(
        `INSERT INTO tags (name, color) VALUES (?, ?)`,
        [name, color],
      );
      const row = queryOne<{ tag_id: number }>(
        `SELECT tag_id FROM tags WHERE name = ?`,
        [name],
      );
      return row?.tag_id ?? null;
    } catch {
      return null; // Tag ya existe (UNIQUE constraint)
    }
  },

  delete(tagId: number): void {
    execute(`DELETE FROM tags WHERE tag_id = ?`, [tagId]);
  },

  getByName(name: string): TagRow | null {
    return queryOne<TagRow>(`SELECT * FROM tags WHERE name = ?`, [name]);
  },

  getAll(): TagRow[] {
    return queryAll<TagRow>(`SELECT * FROM tags ORDER BY name`);
  },

  getForNote(noteId: string): TagRow[] {
    return queryAll<TagRow>(
      `SELECT t.* FROM tags t
       JOIN note_tags nt ON t.tag_id = nt.tag_id
       WHERE nt.note_id = ? ORDER BY t.name`,
      [noteId],
    );
  },

  getAllNoteTagLinks(): { note_id: string; name: string }[] {
    return queryAll<{ note_id: string; name: string }>(
      `SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.tag_id = nt.tag_id`,
    );
  },

  count(): number {
    const row = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM tags`);
    return row?.count ?? 0;
  },
};
