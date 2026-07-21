"""
Schemas para JWPUB — DTOs de importación de publicaciones.
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class JWPUBDocument(BaseModel):
    """Un documento (página) dentro de una publicación JWPUB."""
    DocumentId: int
    Title: str = ""
    Content: str = ""
    ContentLength: int = 0


class JWPUBTOCItem(BaseModel):
    """Item del table of contents (árbol jerárquico)."""
    Id: int
    ParentId: int = -1
    Title: str = ""
    DocumentId: int = -1


class JWPUBPublication(BaseModel):
    """Metadata de la publicación."""
    symbol: str = ""
    title: str = ""
    year: int = 0
    language: int = 0
    issueTagNumber: int = 0
    publicationType: str = ""
    categories: List[str] = []


class JWPUBImportResult(BaseModel):
    """Resultado de importar un .jwpub."""
    success: bool = True
    publication: JWPUBPublication = JWPUBPublication()
    documentCount: int = 0
    documents: List[JWPUBDocument] = []
    toc: List[JWPUBTOCItem] = []
    errors: List[str] = []


class JWPUBDocumentResponse(BaseModel):
    """Respuesta al pedir un documento específico."""
    publication: JWPUBPublication
    document: JWPUBDocument
