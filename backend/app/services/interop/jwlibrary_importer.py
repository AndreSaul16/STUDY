"""
JWLibrary Importer — importa datos reales de un backup .jwlibrary.

Lee las tablas UserMark, Note, BlockRange, Location, Tag, TagMap
y las estructura para mapear con publicaciones JWPUB.

Mapeo clave:
- Location.KeySymbol → publication.symbol (ej: "lff", "w")
- Location.DocumentId → DocumentId en JWPUB
- BlockRange.Identifier → data-pid en HTML (número de párrafo)
- BlockRange.StartToken/EndToken → offsets de tokens (no caracteres)
"""

import io
import sqlite3
import zipfile
from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class UserMarkData:
    """Marca de usuario importada."""
    UserMarkId: int
    ColorIndex: int  # 1-6
    LocationId: int
    UserMarkGuid: str
    # Datos de Location
    KeySymbol: str
    DocumentId: Optional[int]
    BookNumber: Optional[int]
    ChapterNumber: Optional[int]
    # Datos de BlockRange
    BlockType: int  # 1=párrafo, 2=versículo
    Identifier: int  # número de párrafo o versículo
    StartToken: Optional[int]
    EndToken: Optional[int]


@dataclass
class NoteData:
    """Nota importada."""
    NoteId: int
    Guid: str
    Title: str
    Content: str
    LastModified: str
    Created: str
    BlockType: int
    BlockIdentifier: Optional[int]
    # Datos de Location
    KeySymbol: str
    DocumentId: Optional[int]
    BookNumber: Optional[int]
    ChapterNumber: Optional[int]
    # UserMark asociado (si existe)
    UserMarkId: Optional[int]


@dataclass
class TagData:
    """Etiqueta importada."""
    TagId: int
    Type: int  # 0=Favorite, 1=tag
    Name: str


@dataclass
class ImportFullResult:
    """Resultado completo del import."""
    marks: List[UserMarkData]
    notes: List[NoteData]
    tags: List[TagData]
    tag_maps: Dict[int, List[int]]  # NoteId → [TagId]
    locations: Dict[int, Dict[str, Any]]  # LocationId → {KeySymbol, DocumentId, ...}


class JWLibraryImporter:
    """Importa datos reales de un backup .jwlibrary."""

    def import_full(self, file_data: bytes) -> ImportFullResult:
        """
        Importa todos los datos de usuario del backup.

        Returns:
            ImportFullResult con marks, notes, tags, tag_maps, locations
        """
        # Descomprimir ZIP
        zf = zipfile.ZipFile(io.BytesIO(file_data), "r")

        # Buscar userData.db
        db_name = None
        for name in zf.namelist():
            if name.endswith(".db") and "userData" in name:
                db_name = name
                break

        if not db_name:
            raise ValueError("userData.db not found in .jwlibrary")

        db_bytes = zf.read(db_name)

        # Conectar a SQLite
        conn = sqlite3.connect(io.BytesIO(db_bytes))
        conn.row_factory = sqlite3.Row

        # Leer Locations
        locations = self._read_locations(conn)

        # Leer UserMarks + BlockRanges
        marks = self._read_marks(conn, locations)

        # Leer Notes
        notes = self._read_notes(conn, locations)

        # Leer Tags
        tags = self._read_tags(conn)

        # Leer TagMaps
        tag_maps = self._read_tag_maps(conn)

        conn.close()

        return ImportFullResult(
            marks=marks,
            notes=notes,
            tags=tags,
            tag_maps=tag_maps,
            locations=locations,
        )

    def _read_locations(self, conn: sqlite3.Connection) -> Dict[int, Dict[str, Any]]:
        """Lee la tabla Location."""
        cursor = conn.execute("""
            SELECT LocationId, KeySymbol, DocumentId, BookNumber, 
                   ChapterNumber, IssueTagNumber, MepsLanguage, Type, Title
            FROM Location
        """)
        locations = {}
        for row in cursor:
            locations[row["LocationId"]] = {
                "KeySymbol": row["KeySymbol"] or "",
                "DocumentId": row["DocumentId"],
                "BookNumber": row["BookNumber"],
                "ChapterNumber": row["ChapterNumber"],
                "IssueTagNumber": row["IssueTagNumber"],
                "MepsLanguage": row["MepsLanguage"],
                "Type": row["Type"],
                "Title": row["Title"] or "",
            }
        return locations

    def _read_marks(
        self, conn: sqlite3.Connection, locations: Dict[int, Dict[str, Any]]
    ) -> List[UserMarkData]:
        """Lee UserMark + BlockRange + Location."""
        cursor = conn.execute("""
            SELECT 
                um.UserMarkId,
                um.ColorIndex,
                um.LocationId,
                um.UserMarkGuid,
                br.BlockType,
                br.Identifier,
                br.StartToken,
                br.EndToken
            FROM UserMark um
            LEFT JOIN BlockRange br ON um.UserMarkId = br.UserMarkId
        """)

        marks = []
        for row in cursor:
            loc_id = row["LocationId"]
            loc = locations.get(loc_id, {})

            marks.append(UserMarkData(
                UserMarkId=row["UserMarkId"],
                ColorIndex=row["ColorIndex"],
                LocationId=loc_id,
                UserMarkGuid=row["UserMarkGuid"],
                KeySymbol=loc.get("KeySymbol", ""),
                DocumentId=loc.get("DocumentId"),
                BookNumber=loc.get("BookNumber"),
                ChapterNumber=loc.get("ChapterNumber"),
                BlockType=row["BlockType"] or 1,
                Identifier=row["Identifier"] or 0,
                StartToken=row["StartToken"],
                EndToken=row["EndToken"],
            ))

        return marks

    def _read_notes(
        self, conn: sqlite3.Connection, locations: Dict[int, Dict[str, Any]]
    ) -> List[NoteData]:
        """Lee Note + Location."""
        cursor = conn.execute("""
            SELECT 
                n.NoteId,
                n.Guid,
                n.Title,
                n.Content,
                n.LastModified,
                n.Created,
                n.BlockType,
                n.BlockIdentifier,
                n.LocationId,
                n.UserMarkId
            FROM Note n
        """)

        notes = []
        for row in cursor:
            loc_id = row["LocationId"]
            loc = locations.get(loc_id, {})

            notes.append(NoteData(
                NoteId=row["NoteId"],
                Guid=row["Guid"],
                Title=row["Title"] or "",
                Content=row["Content"] or "",
                LastModified=row["LastModified"],
                Created=row["Created"],
                BlockType=row["BlockType"],
                BlockIdentifier=row["BlockIdentifier"],
                KeySymbol=loc.get("KeySymbol", ""),
                DocumentId=loc.get("DocumentId"),
                BookNumber=loc.get("BookNumber"),
                ChapterNumber=loc.get("ChapterNumber"),
                UserMarkId=row["UserMarkId"],
            ))

        return notes

    def _read_tags(self, conn: sqlite3.Connection) -> List[TagData]:
        """Lee la tabla Tag."""
        cursor = conn.execute("SELECT TagId, Type, Name FROM Tag")
        return [
            TagData(
                TagId=row["TagId"],
                Type=row["Type"],
                Name=row["Name"],
            )
            for row in cursor
        ]

    def _read_tag_maps(self, conn: sqlite3.Connection) -> Dict[int, List[int]]:
        """Lee TagMap y devuelve NoteId → [TagId]."""
        cursor = conn.execute("""
            SELECT NoteId, TagId FROM TagMap WHERE NoteId IS NOT NULL
        """)
        tag_maps: Dict[int, List[int]] = {}
        for row in cursor:
            note_id = row["NoteId"]
            tag_id = row["TagId"]
            if note_id not in tag_maps:
                tag_maps[note_id] = []
            tag_maps[note_id].append(tag_id)
        return tag_maps
