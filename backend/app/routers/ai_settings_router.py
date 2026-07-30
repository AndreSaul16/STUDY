"""
AI Settings Router — catálogo de proveedores y listado de modelos.

GET  /api/ai/providers  — catálogo estático (sin key: el selector se pinta siempre)
POST /api/ai/models     — modelos reales de la cuenta del usuario

La key viaja SOLO en la cabecera ``X-AI-Api-Key``. ``/models`` es POST y no GET
a propósito: así la key no puede acabar en una query string (que queda en los
logs del proxy y en el historial del navegador) ni en una caché de URL.

Ningún endpoint de este fichero devuelve una API key.
"""

import logging
import os

from fastapi import APIRouter, Header
from typing import Optional

from ..schemas.ai_settings_schemas import (
    EffortDTO,
    ModelDTO,
    ModelsRequest,
    ModelsResponse,
    ProviderDTO,
    ProvidersResponse,
    ServerDefaultsDTO,
)
from ..services.ai.chat_providers import (
    EFFORT_LABELS,
    PROVIDERS,
    get_provider,
    has_server_key,
    normalize_effort,
    server_provider_id,
)
from ..services.ai.model_catalog import list_models, normalize_purpose

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai-settings"])


@router.get("/providers", response_model=ProvidersResponse)
async def providers() -> ProvidersResponse:
    """
    Catálogo de proveedores y sus capacidades.

    Sin key y sin red: es estático. El selector de proveedor de Ajustes tiene
    que poder pintarse antes de que el usuario tenga nada configurado.
    """
    server_spec = get_provider(server_provider_id())
    server_effort = normalize_effort(
        server_spec, os.getenv("OPENAI_REASONING_EFFORT", "none")
    )

    return ProvidersResponse(
        providers=[
            ProviderDTO(
                id=spec.id,
                label=spec.label,
                key_hint=spec.key_hint,
                key_url=spec.key_url,
                default_model=spec.default_model,
                efforts=[
                    EffortDTO(id=effort, label=EFFORT_LABELS[effort])
                    for effort in spec.efforts
                ],
                supports_images=spec.supports_images,
                supports_deep_research=spec.supports_deep_research,
                image_models=list(spec.image_models),
            )
            for spec in PROVIDERS.values()
        ],
        server=ServerDefaultsDTO(
            provider=server_spec.id,
            model=os.getenv("OPENAI_MODEL", "").strip() or server_spec.default_model,
            effort=server_effort,
            # Booleano, NUNCA la key.
            has_server_key=has_server_key(),
        ),
    )


@router.post("/models", response_model=ModelsResponse)
async def models(
    body: ModelsRequest,
    x_ai_api_key: Optional[str] = Header(default=None, alias="X-AI-Api-Key"),
) -> ModelsResponse:
    """
    Modelos disponibles para la key del usuario.

    Es también el botón de "comprobar mi key": si el proveedor devuelve la
    lista, la key sirve. Un 401 aquí es un 401 saneado, sin eco del cuerpo del
    proveedor.
    """
    spec = get_provider(body.provider)
    purpose = normalize_purpose(body.purpose)

    result = await list_models(spec, x_ai_api_key or "", purpose)

    return ModelsResponse(
        provider=spec.id,
        purpose=purpose,
        models=[ModelDTO(**model) for model in result.models],
        source=result.source,
        notice=result.notice,
    )


__all__ = ["router"]
