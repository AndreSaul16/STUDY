"""
Interop Schemas — DTOs para el motor de interoperabilidad .jwlibrary.

Define:
  - El esquema conocido de userData.db (tablas de la app oficial JW Library).
  - Los DTOs que el frontend envía para inyectar datos.
  - Las respuestas de los endpoints de import/export.

Referencia: el archivo .jwlibrary es un ZIP que contiene:
  - userData.db        (SQLite con notas/marcas del usuario)
  - manifest.json      (metadatos del backup)
  - contents/          (recursos multimedia opcionales)

Esquema de userData.db (tablas relevantes para inyección):
  - UserMark: marcas de subrayado con color y GUID
  - BlockRange: rangos de texto dentro de un bloque
  - Note: notas enriquecidas vinculadas a marcas
  - Tag: etiquetas
  - NoteTag: relación N:M notas-tags
  - Bookmark: marcadores de posición
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ─── Colores de UserMark (mapeo de la app oficial) ───────────────


class JWMarkColor(int, Enum):
    """
    Colores de subrayado en userData.db.
    La app oficial usa enteros 1-9 para los colores.
    """
    YELLOW = 1
    BLUE = 2
    GREEN = 3
    ORANGE = 4
    RED = 5
    PURPLE = 6
    PINK = 7
    BROWN = 8
    GRAY = 9


# ─── DTOs de entrada (desde el frontend) ─────────────────────────


class MarkExportDTO(BaseModel):
    """Una marca de subrayado para exportar a .jwlibrary."""
    local_id: str = Field(..., description="ID local en nuestra DB")
    document_id: int = Field(..., description="DocumentId en la publicación")
    block_index: int = Field(..., description="Índice del bloque dentro del documento")
    color: JWMarkColor = Field(..., description="Color oficial 1-9")
    # Rangos de texto (una marca puede tener múltiples rangos)
    ranges: List["RangeExportDTO"] = Field(
        default_factory=list, description="Rangos de texto marcados"
    )
    # Nota vinculada (opcional)
    note: Optional["NoteExportDTO"] = None


class RangeExportDTO(BaseModel):
    """Un rango de texto dentro de una marca."""
    start_token: int = Field(..., description="Token de inicio (índice de palabra)")
    end_token: int = Field(..., description="Token de fin (exclusivo)")
    token_count: int = Field(..., description="Número de tokens del rango")


class NoteExportDTO(BaseModel):
    """Una nota enriquecida para exportar."""
    title: str = Field("", description="Título de la nota")
    content: str = Field(..., description="Contenido enriquecido (HTML/Markdown)")
    last_modified: str = Field(..., description="ISO 8601 timestamp")


class TagExportDTO(BaseModel):
    """Una etiqueta para exportar."""
    name: str = Field(..., description="Nombre de la etiqueta")
    color: int = Field(0, description="Color de la etiqueta (0 = sin color)")


class ExportRequest(BaseModel):
    """
    Request completa para exportar a .jwlibrary.
    Contiene todas las marcas, notas y etiquetas a inyectar.
    """
    marks: List[MarkExportDTO] = Field(default_factory=list)
    tags: List[TagExportDTO] = Field(default_factory=list)
    # Mapeo nota → etiquetas (por índice en marks)
    note_tag_links: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Links nota-etiqueta: {note_mark_index, tag_name}",
    )


# ─── DTOs de respuesta ───────────────────────────────────────────


class ImportResult(BaseModel):
    """Resultado de importar un .jwlibrary."""
    success: bool
    user_marks_count: int = 0
    notes_count: int = 0
    tags_count: int = 0
    bookmarks_count: int = 0
    documents: List[int] = Field(default_factory=list, description="DocumentIds encontrados")
    errors: List[str] = Field(default_factory=list)


class ExportResult(BaseModel):
    """Resultado de exportar a .jwlibrary."""
    success: bool
    marks_injected: int = 0
    notes_injected: int = 0
    tags_injected: int = 0
    file_size_bytes: int = 0
    errors: List[str] = Field(default_factory=list)


# ─── Esquema SQL de userData.db (para referencia y validación) ───

USERDATA_DB_SCHEMA = """
-- Esquema conocido de userData.db (JW Library app oficial)
-- Tablas relevantes para la inyección de datos.

CREATE TABLE IF NOT EXISTS UserMark (
    UserMarkId INTEGER PRIMARY KEY AUTOINCREMENT,
    DocumentId INTEGER NOT NULL,
    BlockIndex INTEGER NOT NULL,
    BlockRangeCount INTEGER NOT NULL DEFAULT 0,
    Color INTEGER NOT NULL DEFAULT 1,
    UserMarkGuid TEXT NOT NULL,
    Slot INTEGER NOT NULL DEFAULT 0,
    Version INTEGER NOT NULL DEFAULT 0,
    Insensitive BOOLEAN NOT NULL DEFAULT 0,
    OriginalColor INTEGER
);

CREATE TABLE IF NOT EXISTS BlockRange (
    BlockRangeId INTEGER PRIMARY KEY AUTOINCREMENT,
    UserMarkId INTEGER NOT NULL,
    BlockIndex INTEGER NOT NULL,
    StartToken INTEGER NOT NULL,
    EndToken INTEGER NOT NULL,
    TokenCount INTEGER NOT NULL,
    Version INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (UserMarkId) REFERENCES UserMark(UserMarkId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Note (
    NoteId INTEGER PRIMARY KEY AUTOINCREMENT,
    UserMarkId INTEGER,
    DocumentId INTEGER NOT NULL,
    BlockRangeCount INTEGER NOT NULL DEFAULT 0,
    Title TEXT NOT NULL DEFAULT '',
    Content TEXT NOT NULL DEFAULT '',
    LastModified TEXT NOT NULL,
    Version INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (UserMarkId) REFERENCES UserMark(UserMarkId) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Tag (
    TagId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL UNIQUE,
    Color INTEGER NOT NULL DEFAULT 0,
    Version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS NoteTag (
    NoteTagId INTEGER PRIMARY KEY AUTOINCREMENT,
    NoteId INTEGER NOT NULL,
    TagId INTEGER NOT NULL,
    Version INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (NoteId) REFERENCES Note(NoteId) ON DELETE CASCADE,
    FOREIGN KEY (TagId) REFERENCES Tag(TagId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Bookmark (
    BookmarkId INTEGER PRIMARY KEY AUTOINCREMENT,
    Slot INTEGER NOT NULL DEFAULT 0,
    PublicationId INTEGER,
    DocumentId INTEGER,
    BlockIndex INTEGER,
    Version INTEGER NOT NULL DEFAULT 0
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_usermark_document ON UserMark(DocumentId);
CREATE INDEX IF NOT EXISTS idx_blockrange_usermark ON BlockRange(UserMarkId);
CREATE INDEX IF NOT EXISTS idx_note_document ON Note(DocumentId);
CREATE INDEX IF NOT EXISTS idx_notetag_note ON NoteTag(NoteId);
CREATE INDEX IF NOT EXISTS idx_notetag_tag ON NoteTag(TagId);
"""
