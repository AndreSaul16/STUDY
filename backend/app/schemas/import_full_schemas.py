"""
Schemas para import completo de .jwlibrary (datos reales, no solo conteos).
"""

from pydantic import BaseModel
from typing import List, Dict, Optional


class ImportedMark(BaseModel):
    """Marca de usuario importada."""
    UserMarkId: int
    ColorIndex: int  # 1-6
    LocationId: int
    UserMarkGuid: str
    KeySymbol: str
    DocumentId: Optional[int] = None
    BookNumber: Optional[int] = None
    ChapterNumber: Optional[int] = None
    BlockType: int  # 1=párrafo, 2=versículo
    Identifier: int  # número de párrafo
    StartToken: Optional[int] = None
    EndToken: Optional[int] = None


class ImportedNote(BaseModel):
    """Nota importada."""
    NoteId: int
    Guid: str
    Title: str
    Content: str
    LastModified: str
    Created: str
    BlockType: int
    BlockIdentifier: Optional[int] = None
    KeySymbol: str
    DocumentId: Optional[int] = None
    BookNumber: Optional[int] = None
    ChapterNumber: Optional[int] = None
    UserMarkId: Optional[int] = None


class ImportedTag(BaseModel):
    """Etiqueta importada."""
    TagId: int
    Type: int  # 0=Favorite, 1=tag
    Name: str


class ImportFullResult(BaseModel):
    """Resultado completo del import con datos reales."""
    success: bool = True
    marks: List[ImportedMark] = []
    notes: List[ImportedNote] = []
    tags: List[ImportedTag] = []
    tag_maps: Dict[int, List[int]] = {}  # NoteId → [TagId]
    locations: Dict[int, Dict] = {}  # LocationId → {KeySymbol, DocumentId, ...}
    stats: Dict[str, int] = {}  # conteos para UI
