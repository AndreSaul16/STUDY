"""
Schemas de la generación de ilustraciones.

La API key NO está en el cuerpo: viaja en la cabecera ``X-AI-Api-Key`` y no
vuelve en la respuesta. Los bytes de la imagen van en base64 al cliente, que es
quien los persiste: el backend no los escribe en disco.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class ImageRequest(BaseModel):
    """Petición de ilustración."""
    #: Lo que quiere ver el usuario. El backend le añade SIEMPRE el sufijo de
    #: salvaguarda antes de mandarlo al proveedor.
    prompt: str = Field(..., min_length=3, max_length=1500)
    #: Tolerantes: un valor desconocido degrada, no devuelve 422.
    provider: Optional[str] = Field(default=None, max_length=32)
    model: Optional[str] = Field(default=None, max_length=64)
    size: Optional[str] = Field(default=None, max_length=16)
    quality: Optional[str] = Field(default=None, max_length=16)
    n: int = Field(default=1, ge=1, le=2)


class GeneratedImageDTO(BaseModel):
    b64: str
    mime: str
    width: int
    height: int
    revised_prompt: str = ""


class ImageResponse(BaseModel):
    provider: str
    model: str
    #: El prompt final que se mandó, con la salvaguarda incluida. Se devuelve a
    #: propósito: el usuario tiene derecho a ver qué se pidió en su nombre.
    prompt: str
    images: List[GeneratedImageDTO]
    elapsed_ms: int
