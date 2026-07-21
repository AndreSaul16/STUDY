"""
AI Router — endpoint SSE para streaming de análisis de IA.

POST /api/ai/analyze
  Body: AIRequest (skill + context)
  Response: text/event-stream (SSE)

Formato SSE emitido:
  event: metadata
  data: {"skill":"summary","provider":"mock","timestamp":...}

  event: token
  data: {"text":"El ","index":0}

  event: token
  data: {"text":"pasaje ","index":1}

  event: done
  data: {"total_tokens":42,"finish_reason":"stop","elapsed_ms":1234}

El cliente puede cancelar cerrando la conexión (el generator se detiene).
"""

import json
import logging
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from ..schemas.ai_schemas import AIRequest
from ..services.ai import AIService
from ..services.ai.providers import MockProvider, ProviderConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ─── Singleton del AIService ─────────────────────────────────────
# En producción, inyectar via dependency injection con el provider
# configurado según variables de entorno.

_service: AIService | None = None


def get_ai_service() -> AIService:
    """Devuelve el singleton del AIService con el provider configurado."""
    global _service
    if _service is None:
        # Por defecto, MockProvider (no requiere API key)
        # Para usar OpenAI: from ..services.ai.providers.openai_provider import OpenAIProvider
        #   _service = AIService(OpenAIProvider(ProviderConfig(model="gpt-4o")))
        _service = AIService(
            provider=MockProvider(),
            default_config=ProviderConfig(
                model="mock-study-v1",
                temperature=0.7,
                max_tokens=2000,
            ),
        )
    return _service


def _format_sse(event_type: str, data: dict) -> str:
    """Serializa un evento a formato SSE (text/event-stream)."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/analyze")
async def analyze_stream(request: Request, ai_request: AIRequest):
    """
    Endpoint SSE para análisis de IA con streaming.

    El cliente debe leer el stream con EventSource o fetch + ReadableStream.
    Al cerrar la conexión, la generación se detiene automáticamente.
    """
    service = get_ai_service()

    async def event_generator():
        try:
            async for event in service.stream_analysis(ai_request):
                # Si el cliente desconectó, detener
                if await request.is_disconnected():
                    return

                event_type = event["type"].value
                data = event["data"]
                # Pydantic models → dict
                if hasattr(data, "model_dump"):
                    data = data.model_dump()
                yield _format_sse(event_type, data)

        except Exception:
            # Error fatal — loguear con traza y emitir un error genérico al cliente
            logger.exception("AI analyze stream failed")
            error_data = {"message": "Error interno del servidor", "code": "internal_error"}
            yield _format_sse("error", error_data)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx: desactivar buffering
        },
    )


@router.post("/analyze-sync")
async def analyze_sync(ai_request: AIRequest):
    """
    Endpoint no-streaming — devuelve la respuesta completa.

    Útil para tests o cuando no se necesita progresividad.
    """
    service = get_ai_service()
    content = await service.analyze(ai_request)
    return {"content": content, "provider": service.provider.name}


@router.get("/skills")
async def list_skills():
    """Lista las skills disponibles con sus descripciones."""
    from ..schemas.ai_schemas import AISkill

    descriptions = {
        AISkill.SUMMARY: "Resumen estructurado del pasaje",
        AISkill.EXPLAIN_SIMPLE: "Explicación sencilla (estilo ELI5)",
        AISkill.KEY_IDEAS: "Ideas principales en bullet points",
        AISkill.MEDITATION_QUESTIONS: "Preguntas para meditación personal",
        AISkill.CONNECTIONS: "Conexiones con otros pasajes y conceptos",
        AISkill.MIND_MAP: "Mapa mental en formato JSON estricto",
        AISkill.KEYWORDS: "Extracción de palabras clave",
    }
    return {
        "skills": [
            {"id": skill.value, "description": desc}
            for skill, desc in descriptions.items()
        ]
    }


@router.get("/health")
async def ai_health():
    """Health check del AIService y el provider."""
    service = get_ai_service()
    healthy = await service.provider.health_check()
    return {
        "healthy": healthy,
        "provider": service.provider.name,
    }
