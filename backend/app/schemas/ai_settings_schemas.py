"""
Schemas de la configuración de IA (proveedores, modelos, esfuerzo).

Regla que atraviesa todo el fichero: **ninguna respuesta de esta API contiene
una API key**, ni entera ni truncada. La app no tiene autenticación; cualquiera
con la URL de Railway leería lo que devolvamos aquí. Lo máximo que se expone es
un booleano (``has_server_key``) que dice si el backend puede responder sin que
el usuario traiga la suya.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class EffortDTO(BaseModel):
    """Un escalón de esfuerzo tal como lo ve el usuario."""
    id: str
    label: str


class ProviderDTO(BaseModel):
    """Un proveedor de IA con sus capacidades. Catálogo estático, sin key."""
    id: str
    label: str
    key_hint: str
    key_url: str
    default_model: str
    efforts: List[EffortDTO]
    supports_images: bool
    supports_deep_research: bool
    image_models: List[str] = []


class ServerDefaultsDTO(BaseModel):
    """
    Qué tiene configurado el servidor.

    ``has_server_key`` es un booleano a propósito: NUNCA la key.
    """
    provider: str
    model: str
    effort: str
    has_server_key: bool


class ProvidersResponse(BaseModel):
    providers: List[ProviderDTO]
    server: ServerDefaultsDTO


class ModelsRequest(BaseModel):
    """
    Petición del listado de modelos.

    POST y no GET a propósito: la key va en la cabecera y así no se cachea por
    URL ni acaba en un log de acceso.
    """
    provider: str = Field(default="openai", max_length=32)
    #: chat | image | research. Tolerante: un valor desconocido cae en "chat".
    purpose: str = Field(default="chat", max_length=16)


class ModelDTO(BaseModel):
    """Un modelo listo para el desplegable."""
    id: str
    label: str
    description: str = ""
    family: str = ""
    reasoning: bool = False
    context: Optional[int] = None
    recommended: bool = False


class ModelsResponse(BaseModel):
    provider: str
    purpose: str
    models: List[ModelDTO]
    #: "api" = lista real del proveedor · "fallback" = lista estática local.
    source: str
    #: Explicación para el usuario cuando source == "fallback".
    notice: Optional[str] = None
