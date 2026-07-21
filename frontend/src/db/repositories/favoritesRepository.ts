/**
 * FavoritesRepository — favoritos persistidos en SQLite local.
 */

import { queryAll, queryOne, execute } from "@/db/database";

export interface FavoriteRow {
  identifier: string;
  label: string;
  added_at: number;
}

export const favoritesRepository = {
  add(identifier: string, label: string): void {
    execute(
      `INSERT OR IGNORE INTO favorites (identifier, label) VALUES (?, ?)`,
      [identifier, label],
    );
  },

  remove(identifier: string): void {
    execute(`DELETE FROM favorites WHERE identifier = ?`, [identifier]);
  },

  toggle(identifier: string, label: string): boolean {
    const existing = this.isFavorite(identifier);
    if (existing) {
      this.remove(identifier);
      return false;
    } else {
      this.add(identifier, label);
      return true;
    }
  },

  isFavorite(identifier: string): boolean {
    const row = queryOne<{ identifier: string }>(
      `SELECT identifier FROM favorites WHERE identifier = ?`,
      [identifier],
    );
    return row !== null;
  },

  getAll(): FavoriteRow[] {
    return queryAll<FavoriteRow>(
      `SELECT * FROM favorites ORDER BY added_at DESC`,
    );
  },

  count(): number {
    const row = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM favorites`,
    );
    return row?.count ?? 0;
  },
};
