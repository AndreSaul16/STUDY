"""
AIService — orquestador del sistema de IA desacoplado.

Responsabilidades:
  1. Recibe un AIRequest (skill + contexto).
  2. Optimiza el contexto con ContextOptimizer.
  3. Ensambla prompts con PromptOrchestrator.
  4. Delega al AIEngineProvider inyectado (patrón Provider).
  5. Emite eventos SSE (metadata, tokens, done, error).

El AIService NO conoce:
  - Qué proveedor concreto se usa (OpenAI, Anthropic, Mock).
  - FastAPI (devuelve async generators; el router los formatea a SSE).

El AIService SÍ conoce:
  - Las skills y sus budgets.
  - El orchestrator y el optimizer.
  - El formato de eventos SSE (dicts que el router serializa).
"""

import time
from typing import AsyncIterator, Dict, Any
from ...schemas.ai_schemas import (
    AISkill,
    AIRequest,
    SSEEventType,
    SSEMetadata,
    SSEDone,
    SSEError,
)
from .providers.base import AIEngineProvider, ProviderConfig
from .prompt_orchestrator import PromptOrchestrator
from .context_optimizer import ContextOptimizer, estimate_tokens


class AIService:
    """
    Orquestador del sistema de IA.

    Uso:
        service = AIService(provider=MockProvider())
        async for event in service.stream_analysis(request):
            # event = {"type": "metadata" | "token" | "done" | "error", ...}
            ...
    """

    def __init__(
        self,
        provider: AIEngineProvider,
        default_config: ProviderConfig | None = None,
    ):
        self.provider = provider
        self.orchestrator = PromptOrchestrator()
        self.optimizer = ContextOptimizer()
        self.default_config = default_config or ProviderConfig(
            model="mock-model",
            temperature=0.7,
            max_tokens=2000,
        )

    async def stream_analysis(
        self,
        request: AIRequest,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Genera eventos SSE para una request de análisis.

        Yields dicts con forma:
          {"type": "metadata", "data": SSEMetadata}
          {"type": "token", "data": SSEToken}
          {"type": "done", "data": SSEDone}
          {"type": "error", "data": SSEError}

        El router es responsable de serializarlos a formato SSE.
        """
        start_time = time.monotonic()
        skill = request.skill

        try:
            # 1. Ensamblar system prompt para estimar tokens
            system_prompt = self.orchestrator.get_system_prompt(skill)
            system_tokens = estimate_tokens(system_prompt)

            # 2. Optimizar contexto
            optimized_context = self.optimizer.optimize(
                request.context, skill, system_tokens
            )

            # 3. Ensamblar prompts completos
            system_prompt, user_prompt = self.orchestrator.build_prompt(
                skill, optimized_context
            )

            # 4. Configurar provider
            max_tokens = self.optimizer.get_max_tokens(skill)
            config = ProviderConfig(
                model=self.default_config.model,
                api_key=self.default_config.api_key,
                base_url=self.default_config.base_url,
                temperature=request.temperature or self.default_config.temperature,
                max_tokens=request.max_tokens or max_tokens,
                timeout_seconds=self.default_config.timeout_seconds,
            )

            # 5. Emitir metadata inicial
            yield {
                "type": SSEEventType.METADATA,
                "data": SSEMetadata(
                    skill=skill,
                    provider=self.provider.name,
                    timestamp=int(time.time()),
                    estimated_tokens=self.optimizer.estimate_total_tokens(
                        system_prompt, user_prompt, skill
                    ),
                ),
            }

            # 6. Streaming de tokens
            token_count = 0
            async for chunk in self.provider.stream_completion(
                system_prompt, user_prompt, config
            ):
                yield {
                    "type": SSEEventType.TOKEN,
                    "data": {
                        "text": chunk.text,
                        "index": token_count,
                    },
                }
                token_count += 1

                # Si el chunk indica fin, salir del loop
                if chunk.finish_reason is not None:
                    break

            # 7. Evento de finalización
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            yield {
                "type": SSEEventType.DONE,
                "data": SSEDone(
                    total_tokens=token_count,
                    finish_reason="stop",
                    elapsed_ms=elapsed_ms,
                ),
            }

        except Exception as e:
            # Evento de error
            yield {
                "type": SSEEventType.ERROR,
                "data": SSEError(
                    message=str(e),
                    code="provider_error",
                ),
            }

    async def analyze(self, request: AIRequest) -> str:
        """
        Modo no-streaming: devuelve la respuesta completa.

        Útil para tests o endpoints que no necesitan progresividad.
        """
        skill = request.skill
        system_prompt = self.orchestrator.get_system_prompt(skill)
        system_tokens = estimate_tokens(system_prompt)

        optimized = self.optimizer.optimize(
            request.context, skill, system_tokens
        )
        system_prompt, user_prompt = self.orchestrator.build_prompt(skill, optimized)

        max_tokens = self.optimizer.get_max_tokens(skill)
        config = ProviderConfig(
            model=self.default_config.model,
            api_key=self.default_config.api_key,
            base_url=self.default_config.base_url,
            temperature=request.temperature or self.default_config.temperature,
            max_tokens=request.max_tokens or max_tokens,
            timeout_seconds=self.default_config.timeout_seconds,
        )

        return await self.provider.complete(system_prompt, user_prompt, config)
