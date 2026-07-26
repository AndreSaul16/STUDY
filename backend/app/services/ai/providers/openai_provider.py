"""
OpenAIProvider — implementación concreta para OpenAI API.

Ejemplo de cómo añadir un proveedor real sin tocar el AIService.
El SDK de OpenAI se importa de forma diferida para que el backend
pueda arrancar sin la dependencia instalada (modo mock).

Para activar:
  1. pip install openai
  2. export OPENAI_API_KEY="sk-..."
  3. AIService(provider=OpenAIProvider(ProviderConfig(model="gpt-4o")))

El resto del sistema (router, orchestrator, optimizer, frontend) NO cambia.
"""

import os
import re
from typing import Any, AsyncIterator, Dict, Optional

from .base import AIEngineProvider, ProviderConfig, TokenChunk

# Familias de modelos de razonamiento (gpt-5.x, o1/o3/o4). Rechazan
# `max_tokens` (exigen `max_completion_tokens`) y sólo admiten temperature=1.
# Verificado contra la API: pasarles los parámetros clásicos devuelve 400.
_REASONING_MODEL_RE = re.compile(r"^(gpt-5|o[1-9])", re.IGNORECASE)

_VALID_EFFORTS = frozenset({"none", "low", "medium", "high", "xhigh"})


def _is_reasoning_model(model: str) -> bool:
    return bool(_REASONING_MODEL_RE.match(model or ""))


def _build_params(config: ProviderConfig) -> Dict[str, Any]:
    """
    Traduce un ProviderConfig a los parámetros que acepta el modelo concreto.

    Aísla aquí la divergencia entre familias para que el AIService siga sin
    saber nada del SDK ni de qué modelo hay detrás.
    """
    if not _is_reasoning_model(config.model):
        return {
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        }

    params: Dict[str, Any] = {"max_completion_tokens": config.max_tokens}

    effort = (os.getenv("OPENAI_REASONING_EFFORT", "") or "").strip().lower()
    if effort in _VALID_EFFORTS:
        params["reasoning_effort"] = effort

    return params


class OpenAIProvider(AIEngineProvider):
    """
    Provider para OpenAI Chat Completions API con streaming.

    No acopla al resto del sistema al SDK de OpenAI:
    - Recibe prompts ya ensamblados (system + user)
    - Devuelve TokenChunks genéricos
    - El AIService no sabe que esto es OpenAI
    """

    def __init__(self, config: ProviderConfig):
        self.config = config
        self._client = None  # Lazy init

    @property
    def name(self) -> str:
        return "openai"

    def _get_client(self):
        """Lazy initialization del cliente OpenAI."""
        if self._client is None:
            try:
                from openai import AsyncOpenAI
            except ImportError as e:
                raise ImportError(
                    "openai package not installed. Run: pip install openai"
                ) from e

            api_key = self.config.api_key or os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise ValueError(
                    "OPENAI_API_KEY not set. Provide it via config or env var."
                )

            self._client = AsyncOpenAI(
                api_key=api_key,
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
            )
        return self._client

    async def stream_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> AsyncIterator[TokenChunk]:
        client = self._get_client()

        stream = await client.chat.completions.create(
            model=config.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            stream=True,
            **_build_params(config),
        )

        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield TokenChunk(
                    text=chunk.choices[0].delta.content,
                    finish_reason=chunk.choices[0].finish_reason,
                )

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> str:
        client = self._get_client()

        response = await client.chat.completions.create(
            model=config.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            stream=False,
            **_build_params(config),
        )

        return response.choices[0].message.content or ""

    async def health_check(self) -> bool:
        try:
            client = self._get_client()
            # Listar modelos es un endpoint barato para verificar API key
            await client.models.list()
            return True
        except Exception:
            return False
