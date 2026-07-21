"""
AI Engine Provider — interfaz abstracta para proveedores de LLM.

Patrón Provider: el AIService no se acopla a ningún SDK específico.
Cada proveedor (OpenAI, Anthropic, Bedrock, Ollama, Mock) implementa
esta interfaz. Cambiar de proveedor = registrar otra implementación.

El contrato es mínimo:
  - stream_completion: genera texto token a token (async generator)
  - complete: genera texto completo (para tests/no-streaming)

El provider NO conoce:
  - La skill ni el system prompt (eso lo ensambla el PromptOrchestrator)
  - El contexto ni la optimización de tokens (eso lo hace el ContextOptimizer)
  - FastAPI ni SSE (eso lo maneja el router)

El provider SÍ conoce:
  - El modelo concreto y sus parámetros
  - El SDK del proveedor (openai, anthropic, etc.)
"""

from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional
from dataclasses import dataclass


@dataclass
class ProviderConfig:
    """Configuración común a todos los proveedores."""
    model: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 2000
    timeout_seconds: int = 30


@dataclass
class TokenChunk:
    """Chunk emitido por el provider durante streaming."""
    text: str
    finish_reason: Optional[str] = None  # "stop" | "length" | None si no terminó


class AIEngineProvider(ABC):
    """
    Interfaz abstracta que todo proveedor de LLM debe implementar.

    Invariante: stream_completion y complete reciben el prompt YA ensamblado
    (system + user). El provider no interpreta el contenido, solo lo procesa.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Nombre identificativo: 'openai' | 'anthropic' | 'mock' | ..."""
        ...

    @abstractmethod
    async def stream_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> AsyncIterator[TokenChunk]:
        """
        Genera completions en streaming.

        Yields TokenChunk conforme el modelo produce tokens.
        El último chunk tiene finish_reason != None.
        """
        ...

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> str:
        """
        Genera completion completa (no streaming).

        Útil para tests o respuestas que no necesitan progresividad.
        Por defecto, concatena los chunks de stream_completion.
        """
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Verifica que el proveedor está disponible (API key válida, red, etc.)."""
        ...
