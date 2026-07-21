/**
 * NotesRepository — CRUD para notas enriquecidas con tags.
 */

import { queryAll, queryOne, execute } from "@/db/database";

export interface NoteRow {
  note_id: string;
  mark_id: string | null;
  document_id: number;
  publication_key: string;
  block_id: number | null;
  title: string;
  content: string;
  last_modified: number;
  created_at: number;
}

export interface NoteWithTags extends NoteRow {
  tags: { tag_id: number; name: string; color: number }[];
}

const genId = () =>
  `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const notesRepository = {
  create(params: {
    markId?: string | null;
    documentId: number;
    publicationKey?: string;
    blockId?: number | null;
    title?: string;
    content: string;
  }): string {
    const noteId = genId();
    execute(
      `INSERT INTO notes (note_id, mark_id, document_id, publication_key, block_id, title, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        noteId,
        params.markId ?? null,
        params.documentId,
        params.publicationKey ?? "legacy",
        params.blockId ?? null,
        params.title ?? "",
        params.content,
      ],
    );
    return noteId;
  },

  update(noteId: string, fields: { title?: string; content?: string }): void {
    const current = this.getById(noteId);
    if (!current) return;
    execute(
      `UPDATE notes SET title = ?, content = ?, last_modified = strftime('%s','now')
       WHERE note_id = ?`,
      [
        fields.title ?? current.title,
        fields.content ?? current.content,
        noteId,
      ],
    );
  },

  delete(noteId: string): void {
    execute(`DELETE FROM notes WHERE note_id = ?`, [noteId]);
  },

  getById(noteId: string): NoteRow | null {
    return queryOne<NoteRow>(`SELECT * FROM notes WHERE note_id = ?`, [noteId]);
  },

  getByMarkId(markId: string): NoteRow | null {
    return queryOne<NoteRow>(
      `SELECT * FROM notes WHERE mark_id = ?`,
      [markId],
    );
  },

  getByDocument(documentId: number): NoteRow[] {
    return queryAll<NoteRow>(
      `SELECT * FROM notes WHERE document_id = ? ORDER BY created_at DESC`,
      [documentId],
    );
  },

  getAll(limit = 100, offset = 0): NoteRow[] {
    return queryAll<NoteRow>(
      `SELECT * FROM notes ORDER BY last_modified DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  },

  getAllForExport(): NoteRow[] {
    return queryAll<NoteRow>(`SELECT * FROM notes ORDER BY created_at, note_id`);
  },

  getWithTags(noteId: string): NoteWithTags | null {
    const note = this.getById(noteId);
    if (!note) return null;
    const tags = queryAll<{ tag_id: number; name: string; color: number }>(
      `SELECT t.tag_id, t.name, t.color FROM tags t
       JOIN note_tags nt ON t.tag_id = nt.tag_id
       WHERE nt.note_id = ?`,
      [noteId],
    );
    return { ...note, tags };
  },

  addTag(noteId: string, tagId: number): void {
    execute(
      `INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`,
      [noteId, tagId],
    );
  },

  removeTag(noteId: string, tagId: number): void {
    execute(
      `DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?`,
      [noteId, tagId],
    );
  },

  count(): number {
    const row = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM notes`,
    );
    return row?.count ?? 0;
  },
};
