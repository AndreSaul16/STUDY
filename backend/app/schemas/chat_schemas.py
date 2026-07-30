"""
Schemas para el Chat IA con OpenAI + MCP.
"""
from pydantic import BaseModel, Field
from typing import List, Optional


class ChatMessage(BaseModel):
    """Un mensaje en la conversación de chat."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=8000)


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


class ChatModesResponse(BaseModel):
    """Catálogo de modos de redacción."""
    modes: List[ChatModeDTO]
    default: str


class ChatHealthResponse(BaseModel):
    """Respuesta del health check del chat."""
    healthy: bool
    provider: str
    model: str
    mcp_tools_count: int
    error: Optional[str] = None
