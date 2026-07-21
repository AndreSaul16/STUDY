"""
Schemas para el Chat IA con OpenAI + MCP.
"""
from pydantic import BaseModel, Field
from typing import List, Optional


class ChatMessage(BaseModel):
    """Un mensaje en la conversación de chat."""
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    """Request para el endpoint de chat."""
    messages: List[ChatMessage]


class ChatToolCall(BaseModel):
    """Información sobre una llamada a herramienta."""
    name: str
    arguments: dict


class ChatHealthResponse(BaseModel):
    """Respuesta del health check del chat."""
    healthy: bool
    provider: str
    model: str
    mcp_tools_count: int
    error: Optional[str] = None
