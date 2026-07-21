"""
AI Schemas — DTOs estrictos para el sistema de IA desacoplado.

Define:
  - AIContext: el paquete de contexto que el frontend envía al backend.
  - AISkill: enum de tareas que la IA puede ejecutar.
  - AIRequest: request completo (contexto + skill).
  - Eventos SSE: streaming de tokens, metadatos, errores y finalización.

Estos modelos son la frontera entre frontend y backend. Cualquier cambio
aquí debe reflejarse en frontend/src/types/ai.ts.
"""

from enum import Enum
from typing import List, Optional, Dict, Any, AsyncIterator
from pydantic import BaseModel, Field


# ─── Skills (tareas ejecutables) ─────────────────────────────────


class AISkill(str, Enum):
    """Tareas que la IA puede ejecutar bajo demanda."""
    SUMMARY = "summary"                      # Resumen estructurado
    EXPLAIN_SIMPLE = "explain_simple"        # Explicación sencilla
    KEY_IDEAS = "key_ideas"                  # Ideas principales (bullet points)
    MEDITATION_QUESTIONS = "meditation_questions"  # Preguntas para meditar
    CONNECTIONS = "connections"              # Conexiones entre capítulos/conceptos
    MIND_MAP = "mind_map"                    # Mapa mental (JSON estricto)
    KEYWORDS = "keywords"                    # Extracción de palabras clave


# ─── Contexto de entrada ─────────────────────────────────────────


class ReferenceContext(BaseModel):
    """Referencia activada por el usuario (del ReferenceEngine)."""
    identifier: str = Field(..., description="ID único de la referencia")
    label: str = Field(..., description="Etiqueta legible: 'Salmo 23:1'")
    type: str = Field(..., description="scripture | publication | footnote | cross_reference")
    resolved_content: Optional[str] = Field(
        None, description="Contenido expandido de la referencia (si se resolvió)"
    )


class BlockContext(BaseModel):
    """Bloque de contenido adyacente para dar contexto al modelo."""
    block_id: int
    block_type: str = Field(..., description="paragraph | chapter | title | image")
    content: str


class AIContext(BaseModel):
    """
    Paquete de contexto que el frontend envía al backend.

    Contiene exactamente lo que el modelo necesita para generar un análisis
    relevante sin alucinar: el párrafo actual, contexto adyacente (anterior
    y siguiente), metadatos de capítulo/publicación, y referencias activadas.
    """
    # Párrafo foco — el que el usuario está leyendo/seleccionó
    current_block: BlockContext = Field(..., description="Bloque foco del análisis")

    # Contexto adyacente — ventana de bloques alrededor del foco
    preceding_blocks: List[BlockContext] = Field(
        default_factory=list,
        description="Bloques anteriores al foco (orden cronológico)",
    )
    following_blocks: List[BlockContext] = Field(
        default_factory=list,
        description="Bloques posteriores al foco (orden cronológico)",
    )

    # Metadatos estructurales
    chapter_title: Optional[str] = Field(None, description="Título del capítulo actual")
    publication_title: str = Field(..., description="Título de la publicación/artículo")
    document_id: int = Field(..., description="ID del documento")

    # Referencias activadas por el usuario
    active_references: List[ReferenceContext] = Field(
        default_factory=list,
        description="Referencias que el usuario ha abierto en el panel derecho",
    )

    # Preferencias del usuario
    language: str = Field("es", description="Idioma de salida (ISO 639-1)")


class AIRequest(BaseModel):
    """Request completo al AIService."""
    skill: AISkill = Field(..., description="Tarea a ejecutar")
    context: AIContext = Field(..., description="Contexto empaquetado")
    # Opcional: override de parámetros del modelo
    temperature: Optional[float] = Field(
        None, ge=0.0, le=2.0, description="Override de temperatura"
    )
    max_tokens: Optional[int] = Field(
        None, ge=100, le=8000, description="Override de max tokens"
    )


# ─── Eventos SSE (Server-Sent Events) ────────────────────────────
#
# El endpoint SSE emite eventos con tipo (event:) y data (JSON).
# Cada evento se serializa como:
#   event: {type}\n
#   data: {json}\n\n


class SSEEventType(str, Enum):
    """Tipos de evento que el backend emite via SSE."""
    METADATA = "metadata"      # Metadatos iniciales (skill, provider, timestamp)
    TOKEN = "token"            # Token generado (streaming progresivo)
    DELTA = "delta"            # Bloque de texto (varios tokens)
    DONE = "done"              # Generación completada
    ERROR = "error"            # Error durante la generación
    CANCELLED = "cancelled"    # Generación cancelada por el cliente


class SSEMetadata(BaseModel):
    """Primer evento: metadatos de la sesión de IA."""
    skill: AISkill
    provider: str = Field(..., description="Nombre del proveedor: 'mock' | 'openai' | ...")
    timestamp: int
    estimated_tokens: Optional[int] = None


class SSEToken(BaseModel):
    """Evento de token individual."""
    text: str
    index: int = Field(..., description="Índice secuencial del token (0-based)")


class SSEDone(BaseModel):
    """Evento de finalización."""
    total_tokens: int
    finish_reason: str = Field(..., description="stop | length | cancelled")
    elapsed_ms: int


class SSEError(BaseModel):
    """Evento de error."""
    message: str
    code: str = Field(..., description="Código de error: 'provider_error' | 'context_too_large' | ...")


# ─── Respuesta completa (no streaming, para tests) ───────────────


class AIResponse(BaseModel):
    """Respuesta completa (modo no-streaming, útil para tests)."""
    skill: AISkill
    content: str
    provider: str
    tokens_used: int
    elapsed_ms: int
