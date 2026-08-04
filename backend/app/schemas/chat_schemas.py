"""
Schemas para el Chat IA con OpenAI + MCP.
"""
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from typing import Any, List, Optional

from ..services.ai.local_library import (
    MAX_SNIPPET_CHARS,
    MAX_SNIPPETS,
    MAX_SYMBOL_CHARS,
    MAX_TITLE_CHARS,
)

#: Tope de cada campo de texto de un fragmento .jwpub. A nivel de módulo y no
#: dentro del validador: se consulta una vez por campo y por fragmento.
_LIMITES_DE_TEXTO = {
    "symbol": MAX_SYMBOL_CHARS,
    "publication": MAX_TITLE_CHARS,
    "document_title": MAX_TITLE_CHARS,
    "text": MAX_SNIPPET_CHARS,
}


class ChatMessage(BaseModel):
    """Un mensaje en la conversación de chat."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=8000)


class ResearchOptions(BaseModel):
    """
    Ajustes de investigación que manda el cliente.

    Un solo interruptor de cara al usuario (`internet`). El bloqueo de material
    apostata y los avisos de antigüedad NO están aquí a propósito: son raíles
    de seguridad, y un cliente no puede apagar un raíl mandando un booleano.

    Tolerante —sin `pattern`, todo con default— porque un cliente antiguo no
    manda este objeto y no puede recibir un 422 por eso.
    """

    #: ¿Puede el agente salir de jw.org a buscar datos en catálogos científicos?
    internet: bool = True
    #: Suelo de antigüedad por defecto de las búsquedas. None = sin suelo.
    min_year: Optional[int] = Field(default=None, ge=1870, le=2200)
    #: Resultados por búsqueda externa.
    max_results: int = Field(default=6, ge=1, le=12)


class LocalLibrarySnippet(BaseModel):
    """
    Un fragmento de una publicación .jwpub del dispositivo del usuario.

    Los .jwpub viven en IndexedDB del navegador, no aquí (ver
    services/ai/local_library.py): el cliente busca y manda solo lo relevante.

    **Los topes se aplican TRUNCANDO, no rechazando.** Podría ponerse
    ``max_length`` en los campos y devolver un 422, pero eso convierte cualquier
    desajuste de versión —un cliente que suba su tope de 700 a 800 caracteres—
    en un chat que deja de responder. Truncar acota igual de duro (esto entra
    directo en el prompt y el cliente no es de fiar) y degrada en vez de romper,
    que es el criterio del resto del contrato.
    """

    symbol: str = ""
    publication: str = ""
    document_title: str = ""
    text: str = ""
    document_id: Optional[int] = None

    @field_validator("symbol", "publication", "document_title", "text", mode="before")
    @classmethod
    def _recortar(cls, value: Any, info: ValidationInfo) -> str:
        if not isinstance(value, str):
            return ""
        return value[: _LIMITES_DE_TEXTO.get(info.field_name, MAX_TITLE_CHARS)]

    @field_validator("document_id", mode="before")
    @classmethod
    def _id_o_nada(cls, value: Any) -> Optional[int]:
        # Un id que no es un número deja el fragmento sin enlace, no sin turno.
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None


class ChatRequest(BaseModel):
    """Request para el endpoint de chat."""
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=50)
    #: Modo de redacción (ver services/ai/chat_modes.py). Deliberadamente SIN
    #: `pattern`: un cliente antiguo no lo manda y uno nuevo puede mandar un
    #: modo que este backend aún no conoce. `get_mode()` degrada al default;
    #: devolver 422 por esto rompería el chat sin motivo.
    mode: Optional[str] = Field(default=None, max_length=32)
    #: Id de la conversación del cliente. Solo eco/telemetría: el historial se
    #: persiste en el SQLite local del navegador, no en el backend.
    conversation_id: Optional[str] = Field(default=None, max_length=64)
    #: Proveedor, modelo y esfuerzo elegidos por el usuario. Los tres son
    #: opcionales y TOLERANTES (sin `pattern`): un valor desconocido degrada al
    #: default en la capa de proveedor, nunca devuelve 422. La API KEY no está
    #: aquí a propósito: viaja solo en la cabecera X-AI-Api-Key para que no
    #: acabe en ningún cuerpo persistido ni en un log de acceso.
    provider: Optional[str] = Field(default=None, max_length=32)
    model: Optional[str] = Field(default=None, max_length=128)
    effort: Optional[str] = Field(default=None, max_length=16)
    #: Ajustes de investigación. Ausente = los valores por defecto (todo
    #: activado), que es lo que manda un cliente que no los conoce.
    research: Optional[ResearchOptions] = None
    #: Fragmentos de las publicaciones .jwpub que el usuario tiene en su
    #: dispositivo y ha marcado en Ajustes. Opcional y con default vacío: lo
    #: normal es no mandar nada, y el `frontend/dist` desplegado no lo conoce.
    #:
    #: La lista se recorta a MAX_SNIPPETS en vez de rechazarse por el mismo
    #: motivo que los campos de LocalLibrarySnippet: un cliente que mande de
    #: más tiene que perder los sobrantes, no el turno.
    local_library: List[LocalLibrarySnippet] = Field(default_factory=list)

    @field_validator("local_library", mode="before")
    @classmethod
    def _recortar_biblioteca(cls, value: Any) -> Any:
        # `null` o basura: el cliente no manda biblioteca, no es un error.
        if not isinstance(value, list):
            return []
        # Los elementos que no son objetos se tiran AQUÍ y no se dejan pasar a
        # pydantic: allí serían un 422, y un solo elemento mal formado no puede
        # llevarse por delante la pregunta entera.
        return [item for item in value if isinstance(item, dict)][:MAX_SNIPPETS]


class ChatToolCall(BaseModel):
    """Información sobre una llamada a herramienta."""
    name: str
    arguments: dict


class ChatModeDTO(BaseModel):
    """Un modo de redacción tal como lo ve el cliente (sin el prompt)."""
    id: str
    label: str
    hint: str
    examples: List[str]
    #: Modo de investigación profunda: responde con un `event: job` y una
    #: espera de minutos, no con tokens. Un cliente antiguo lo ignora.
    deep: bool = False


class ChatModesResponse(BaseModel):
    """Catálogo de modos de redacción."""
    modes: List[ChatModeDTO]
    default: str


class ChatHealthResponse(BaseModel):
    """
    Respuesta del health check del chat.

    ``has_server_key`` es un booleano y NO la key: sin autenticación, cualquiera
    con la URL leería la respuesta de este endpoint.
    """
    healthy: bool
    provider: str
    model: str
    mcp_tools_count: int
    has_server_key: bool = False
    error: Optional[str] = None
