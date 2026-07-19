from pydantic import BaseModel
from typing import List, Optional

class PublicationBlock(BaseModel):
    blockId: int
    blockType: str
    content: str

class Article(BaseModel):
    documentId: int
    title: str
    blocks: List[PublicationBlock]
