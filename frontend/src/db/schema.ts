/**
 * Schema SQL local — base de datos SQLite del espacio de trabajo del usuario.
 *
 * Ejecutado por database.ts al inicializar sql.js.
 *
 * NOTA: sql.js (build npm estándar) NO incluye FTS5 compilado.
 * Por eso dividimos el schema en dos:
 *  - LOCAL_DB_SCHEMA_BASE: tablas normales (siempre aplicable)
 *  - LOCAL_DB_SCHEMA_FTS5: tabla virtual FTS5 + triggers (solo si el motor la soporta)
 *
 * Si FTS5 no está disponible, el SearchRepository cae automáticamente
 * a una búsqueda LIKE con ranking manual (ver searchRepository.ts).
 */

export const LOCAL_DB_SCHEMA_BASE = `
-- ─── Espacio de trabajo del usuario ──────────────────────────────

-- Documentos estudiados (cache local de metadatos)
CREATE TABLE IF NOT EXISTS documents (
    document_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    publication TEXT,
    last_read_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Bloques guardados (para reabrir documentos rápido)
CREATE TABLE IF NOT EXISTS blocks (
    block_id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    block_index INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

-- Marcas de subrayado (multi-color)
CREATE TABLE IF NOT EXISTS user_marks (
    mark_id TEXT PRIMARY KEY,           -- UUID local
    document_id INTEGER NOT NULL,
    publication_key TEXT NOT NULL DEFAULT 'legacy',
    block_id INTEGER NOT NULL,
    color TEXT NOT NULL DEFAULT 'yellow',  -- yellow|green|blue|pink|orange
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    selected_text TEXT NOT NULL,
    start_token INTEGER NOT NULL DEFAULT 0,
    end_token INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    FOREIGN KEY (block_id) REFERENCES blocks(block_id) ON DELETE CASCADE
);

-- Notas enriquecidas (vinculadas a marcas o independientes)
CREATE TABLE IF NOT EXISTS notes (
    note_id TEXT PRIMARY KEY,           -- UUID local
    mark_id TEXT,                       -- Vinculo a marca (opcional)
    document_id INTEGER NOT NULL,
    publication_key TEXT NOT NULL DEFAULT 'legacy',
    block_id INTEGER,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',   -- HTML/Markdown enriquecido
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (mark_id) REFERENCES user_marks(mark_id) ON DELETE SET NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

-- Etiquetas
CREATE TABLE IF NOT EXISTS tags (
    tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Relación N:M notas-etiquetas
CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);

-- Favoritos (referencias marcadas)
CREATE TABLE IF NOT EXISTS favorites (
    identifier TEXT PRIMARY KEY,        -- reference.identifier del ReferenceEngine
    label TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Historial de navegación
CREATE TABLE IF NOT EXISTS history (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER,
    block_id INTEGER,
    reference_identifier TEXT,           -- Si se navegó a una referencia
    action TEXT NOT NULL,                -- 'open_document' | 'open_reference' | 'toggle_favorite'
    visited_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ─── Conversaciones con la IA ────────────────────────────────────
-- El historial del chat vive AQUÍ, en el navegador, y no en el backend:
-- la app no tiene autenticación (un historial en Railway sería compartido
-- por quien abriera la URL) y el contenedor tiene filesystem efímero.
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT 'Conversación nueva',
    mode            TEXT NOT NULL DEFAULT 'analisis',
    pinned          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id       TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL,
    seq              INTEGER NOT NULL,
    role             TEXT NOT NULL,             -- 'user' | 'assistant'
    content          TEXT NOT NULL,
    mode             TEXT,
    sources_json     TEXT NOT NULL DEFAULT '[]',
    tools_json       TEXT NOT NULL DEFAULT '[]',
    suggestions_json TEXT NOT NULL DEFAULT '[]',
    meta_json        TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

-- ─── Ilustraciones generadas ────────────────────────────────────
-- Los bytes se guardan aquí y NO en el backend: el contenedor de Railway
-- tiene filesystem efímero, así que una imagen "guardada" allí duraría hasta
-- el siguiente deploy.
CREATE TABLE IF NOT EXISTS chat_images (
    image_id        TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id      TEXT,
    prompt          TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    mime            TEXT NOT NULL DEFAULT 'image/png',
    width           INTEGER NOT NULL DEFAULT 0,
    height          INTEGER NOT NULL DEFAULT 0,
    bytes           INTEGER NOT NULL DEFAULT 0,
    data_b64        TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ─── Índices para rendimiento ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_marks_document ON user_marks(document_id);
CREATE INDEX IF NOT EXISTS idx_marks_publication_document ON user_marks(publication_key, document_id);
CREATE INDEX IF NOT EXISTS idx_marks_block ON user_marks(block_id);
CREATE INDEX IF NOT EXISTS idx_notes_document ON notes(document_id);
CREATE INDEX IF NOT EXISTS idx_notes_publication_document ON notes(publication_key, document_id);
CREATE INDEX IF NOT EXISTS idx_notes_mark ON notes(mark_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_history_document ON history(document_id);
CREATE INDEX IF NOT EXISTS idx_history_visited ON history(visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_images_conv ON chat_images(conversation_id, created_at DESC);

-- ─── Versión del esquema (para migraciones) ─────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (2);
INSERT OR IGNORE INTO schema_version (version) VALUES (3);
INSERT OR IGNORE INTO schema_version (version) VALUES (4);
`;

/**
 * Migración a la v3 — tablas del chat.
 *
 * Solo AÑADE tablas e índices: ningún DROP, ningún ALTER destructivo. Se
 * aplica también sobre bases v2 ya existentes en el dispositivo del usuario.
 *
 * Deliberadamente sin FTS5: sql.js estándar no lo trae y la búsqueda de
 * conversaciones se resuelve con LIKE (mismo fallback que searchRepository).
 */
export const LOCAL_DB_SCHEMA_CHAT = `
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT 'Conversación nueva',
    mode            TEXT NOT NULL DEFAULT 'analisis',
    pinned          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id       TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL,
    seq              INTEGER NOT NULL,
    role             TEXT NOT NULL,
    content          TEXT NOT NULL,
    mode             TEXT,
    sources_json     TEXT NOT NULL DEFAULT '[]',
    tools_json       TEXT NOT NULL DEFAULT '[]',
    suggestions_json TEXT NOT NULL DEFAULT '[]',
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

INSERT OR IGNORE INTO schema_version (version) VALUES (3);
`;

/**
 * Migración a la v4 — ilustraciones generadas y metadatos del mensaje.
 *
 * Aditiva igual que la v3: solo CREATE IF NOT EXISTS. La columna `meta_json`
 * no se puede añadir aquí (SQLite no tiene `ADD COLUMN IF NOT EXISTS`); se
 * añade en `migrateImageTables()` con la guarda de PRAGMA table_info, el mismo
 * patrón que `migratePublicationScopes`.
 */
export const LOCAL_DB_SCHEMA_IMAGES = `
CREATE TABLE IF NOT EXISTS chat_images (
    image_id        TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id      TEXT,
    prompt          TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    mime            TEXT NOT NULL DEFAULT 'image/png',
    width           INTEGER NOT NULL DEFAULT 0,
    height          INTEGER NOT NULL DEFAULT 0,
    bytes           INTEGER NOT NULL DEFAULT 0,
    data_b64        TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_images_conv ON chat_images(conversation_id, created_at DESC);

INSERT OR IGNORE INTO schema_version (version) VALUES (4);
`;

/**
 * Schema FTS5 — solo se aplica si el motor SQLite soporta FTS5.
 * Tabla virtual + triggers para mantener el índice sincronizado.
 */
export const LOCAL_DB_SCHEMA_FTS5 = `
-- ─── Búsqueda semántica con FTS5 ────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    mark_id UNINDEXED,
    document_id UNINDEXED,
    title,
    content,
    selected_text,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(note_id, mark_id, document_id, title, content, selected_text)
    VALUES (new.note_id, new.mark_id, new.document_id, new.title, new.content,
        COALESCE((SELECT selected_text FROM user_marks WHERE mark_id = new.mark_id), ''));
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    DELETE FROM notes_fts WHERE note_id = old.note_id;
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    DELETE FROM notes_fts WHERE note_id = old.note_id;
    INSERT INTO notes_fts(note_id, mark_id, document_id, title, content, selected_text)
    VALUES (new.note_id, new.mark_id, new.document_id, new.title, new.content,
        COALESCE((SELECT selected_text FROM user_marks WHERE mark_id = new.mark_id), ''));
END;
`;

/**
 * Compatibilidad: exportamos el schema completo para código legacy.
 * Prefiere usar applySchema() desde database.ts que detecta FTS5.
 */
export const LOCAL_DB_SCHEMA = LOCAL_DB_SCHEMA_BASE + LOCAL_DB_SCHEMA_FTS5;
