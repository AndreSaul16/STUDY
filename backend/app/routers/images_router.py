"""
Images Router — generación de ilustraciones.

POST /api/images/generate — header X-AI-Api-Key, cuerpo con prompt y opciones.

Los bytes vuelven en base64 y **no tocan el disco del backend**: el contenedor
de Railway tiene filesystem efímero y la app no tiene autenticación, así que un
almacén de imágenes en el servidor sería a la vez temporal y compartido. El
cliente los guarda en su SQLite local.
"""

import logging
import time

from fastapi import APIRouter, Header
from typing import Optional

from ..schemas.image_schemas import GeneratedImageDTO, ImageRequest, ImageResponse
from ..services.ai.chat_providers import get_provider, server_api_key
from ..services.ai.image_service import build_prompt, generate_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/images", tags=["images"])


@router.post("/generate", response_model=ImageResponse)
async def generate(
    body: ImageRequest,
    x_ai_api_key: Optional[str] = Header(default=None, alias="X-AI-Api-Key"),
) -> ImageResponse:
    """
    Genera una o dos ilustraciones a partir de una descripción.

    La key del usuario manda; si no la trae, se usa la del servidor (mismo
    criterio que el chat: sin configurar nada, la app sigue funcionando).
    """
    spec = get_provider(body.provider)
    api_key = (x_ai_api_key or "").strip() or server_api_key(spec)

    started = time.time()
    model, images = await generate_image(
        spec,
        api_key,
        body.prompt,
        model=body.model,
        size=body.size,
        quality=body.quality,
        n=body.n,
    )

    return ImageResponse(
        provider=spec.id,
        model=model,
        prompt=build_prompt(body.prompt),
        images=[GeneratedImageDTO(**image.to_dict()) for image in images],
        elapsed_ms=int((time.time() - started) * 1000),
    )


__all__ = ["router"]
