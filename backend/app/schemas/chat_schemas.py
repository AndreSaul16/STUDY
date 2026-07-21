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
