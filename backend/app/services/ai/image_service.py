"""
Image service — generación de ilustraciones para acompañar una pieza.

Encaje de producto (decisión antes que código): NO es un modo del chat ni una
herramienta que el modelo pueda invocar por su cuenta. Es una **acción sobre un
mensaje ya escrito** ("Ilustrar esto"), con el coste a la vista y el prompt
editable. Un modelo que decide gastar 0,20 $ por iniciativa propia es mal
producto.

Salvaguarda de contenido, NO negociable: al prompt del usuario se le añade
SIEMPRE el sufijo de ``SAFEGUARD_SUFFIX`` — sin texto en la imagen y sin
representaciones de personas bíblicas ni escenas religiosas identificables. La
ilustración parte del hecho del mundo real (el árbol, el edificio, la guardia),
que es de donde parten también las ilustraciones del usuario.

Los bytes NO tocan el disco del backend: el contenedor de Railway tiene
filesystem efímero, así que una imagen "guardada" allí duraría hasta el
siguiente deploy. Se devuelven en base64 y el cliente los persiste en su
SQLite local.
"""

from __future__ import annotations

import base64
import binascii
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException

from .chat_providers import ProviderSpec
from .redaction import redact

logger = logging.getLogger(__name__)


#: El sufijo que va SIEMPRE. Hay un test que lo blinda palabra por palabra.
SAFEGUARD_SUFFIX = (
    "sin texto ni caracteres en la imagen, sin representaciones de personas "
    "bíblicas ni escenas religiosas identificables"
)

#: Estilo por defecto: lo que hace que las ilustraciones parezcan de la misma
#: familia en vez de un collage.
STYLE_SUFFIX = (
    "Ilustración fotorrealista y sobria, luz natural, sin marcas ni logotipos"
)

#: Tope del prompt. Más allá los proveedores lo recortan por su cuenta y el
#: sufijo de salvaguarda sería lo primero en caerse: se recorta ANTES.
MAX_PROMPT_CHARS = 1500

#: Segundos. Una imagen de alta calidad tarda de 30 a 90 s.
HTTP_TIMEOUT_SECONDS = 120.0

_SIZES: Tuple[str, ...] = ("1024x1024", "1024x1536", "1536x1024")
DEFAULT_SIZE = "1024x1024"

_QUALITIES: Tuple[str, ...] = ("low", "medium", "high")
DEFAULT_QUALITY = "medium"

MAX_IMAGES = 2

_OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"

_POLICY_MESSAGE = (
    "El proveedor ha rechazado esta descripción. Prueba a describir solo el "
    "objeto o el fenómeno natural."
)


@dataclass(frozen=True)
class GeneratedImage:
    """Una imagen generada, lista para viajar por JSON."""

    b64: str
    mime: str
    width: int
    height: int
    revised_prompt: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "b64": self.b64,
            "mime": self.mime,
            "width": self.width,
            "height": self.height,
            "revised_prompt": self.revised_prompt,
        }


# ─── Normalización (pura, testeable sin red) ─────────────────────


def build_prompt(prompt: str, style: bool = True) -> str:
    """
    Prompt final: lo que pidió el usuario + estilo + salvaguarda.

    El recorte se hace sobre la parte del usuario, nunca sobre el sufijo: la
    salvaguarda tiene que sobrevivir a un prompt kilométrico.
    """
    base = " ".join((prompt or "").split()).strip()
    tail = f"{STYLE_SUFFIX}. {SAFEGUARD_SUFFIX}." if style else f"{SAFEGUARD_SUFFIX}."

    room = MAX_PROMPT_CHARS - len(tail) - 2
    if room > 0 and len(base) > room:
        base = base[:room].rstrip()

    return f"{base}. {tail}" if base else tail


def normalize_size(size: Optional[str]) -> str:
    value = str(size or "").strip().lower().replace(" ", "")
    return value if value in _SIZES else DEFAULT_SIZE


def normalize_quality(quality: Optional[str]) -> str:
    value = str(quality or "").strip().lower()
    return value if value in _QUALITIES else DEFAULT_QUALITY


def normalize_count(n: Any) -> int:
    try:
        value = int(n)
    except (TypeError, ValueError):
        return 1
    return max(1, min(value, MAX_IMAGES))


def normalize_model(spec: ProviderSpec, model: Optional[str]) -> str:
    """
    Modelo de imagen válido para ``spec``.

    Lista cerrada a propósito: los ids de imagen son pocos y conocidos, y uno
    de ellos (``gpt-image-1``) está en retirada. Que el cliente pueda mandar
    cualquier cosa aquí solo produciría 400 del proveedor.
    """
    value = str(model or "").strip()
    if value in spec.image_models:
        return value
    return spec.image_models[0] if spec.image_models else ""


def images_url(spec: ProviderSpec) -> str:
    if spec.base_url:
        return f"{spec.base_url.rstrip('/')}/images/generations"
    return _OPENAI_IMAGES_URL


def build_request(
    spec: ProviderSpec,
    prompt: str,
    model: str,
    size: str,
    quality: str,
    n: int,
) -> Dict[str, Any]:
    """
    Cuerpo de la petición, distinto por proveedor.

    OpenAI acepta ``quality`` y ``output_format``; se pide **webp**, que pesa
    del orden de cinco veces menos que el PNG. Importa mucho más de lo que
    parece: la base local vive entera en RAM y se serializa completa en cada
    guardado (sql.js), así que un PNG de 1024² en base64 (~2 MB) por imagen
    haría la app inusable en un móvil.

    La capa de compatibilidad de Google solo admite ``prompt``, ``model``,
    ``n``, ``size`` y ``response_format``.
    """
    if spec.id == "google":
        return {
            "model": model,
            "prompt": prompt,
            "n": n,
            "size": size,
            "response_format": "b64_json",
        }

    return {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": n,
        "output_format": "webp",
    }


def _sniff_mime(raw: bytes) -> str:
    """
    Tipo real de la imagen a partir de sus primeros bytes.

    Se prefiere esto a fiarse del ``output_format`` pedido: Google no lo acepta
    y devuelve lo que quiere. Un mime equivocado rompe el ``data:`` URI del
    cliente y la imagen no se ve.
    """
    if raw[:4] == b"\x89PNG":
        return "image/png"
    if raw[:2] == b"\xff\xd8":
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def parse_response(payload: Dict[str, Any], size: str) -> List[GeneratedImage]:
    """Convierte la respuesta del proveedor en ``GeneratedImage``."""
    width, _, height = size.partition("x")
    try:
        w, h = int(width), int(height)
    except ValueError:
        w = h = 0

    images: List[GeneratedImage] = []
    for item in (payload.get("data") or []) if isinstance(payload, dict) else []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("b64_json")
        if not isinstance(b64, str) or not b64:
            continue

        try:
            raw = base64.b64decode(b64[:64] + "=" * (-len(b64[:64]) % 4), validate=False)
        except (binascii.Error, ValueError):
            raw = b""

        images.append(
            GeneratedImage(
                b64=b64,
                mime=_sniff_mime(raw),
                width=w,
                height=h,
                revised_prompt=str(item.get("revised_prompt") or ""),
            )
        )
    return images


# ─── Errores saneados ────────────────────────────────────────────


def _raise_provider_error(spec: ProviderSpec, response: httpx.Response) -> None:
    """
    Traduce el error del proveedor SIN reenviar su cuerpo tal cual.

    Solo se mira el CÓDIGO de error (``content_policy_violation``), nunca el
    mensaje: algunos 401 hacen eco del prefijo de la key que se les mandó.
    """
    status = response.status_code
    if status in (401, 403):
        raise HTTPException(401, f"La API key no es válida para {spec.label}.")
    if status == 429:
        raise HTTPException(
            429, "El proveedor está limitando las peticiones. Prueba en un minuto."
        )

    code = ""
    try:
        error = (response.json() or {}).get("error") or {}
        code = str(error.get("code") or error.get("type") or "")
    except Exception:
        code = ""

    if "content_policy" in code or "moderation" in code or status == 400:
        raise HTTPException(400, _POLICY_MESSAGE)

    raise HTTPException(502, f"{spec.label} no ha podido generar la imagen.")


# ─── Llamada ─────────────────────────────────────────────────────


async def generate_image(
    spec: ProviderSpec,
    api_key: str,
    prompt: str,
    model: Optional[str] = None,
    size: Optional[str] = None,
    quality: Optional[str] = None,
    n: Any = 1,
) -> Tuple[str, List[GeneratedImage]]:
    """
    Genera imágenes. Devuelve ``(modelo_usado, imágenes)``.

    Sin streaming en esta versión: una barra de progreso parcial no compensa la
    complejidad cuando la espera son 30-90 segundos y el usuario ya ve el
    tiempo transcurrido.
    """
    if not (api_key or "").strip():
        raise HTTPException(
            428, "Configura tu API key en Más → Ajustes de IA para generar imágenes."
        )
    if not spec.image_models:
        raise HTTPException(400, f"{spec.label} no genera imágenes.")

    chosen = normalize_model(spec, model)
    final_size = normalize_size(size)
    body = build_request(
        spec,
        build_prompt(prompt),
        chosen,
        final_size,
        normalize_quality(quality),
        normalize_count(n),
    )

    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    if spec.key_header.lower() != "authorization":
        headers = {spec.key_header: api_key.strip()}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(images_url(spec), headers=headers, json=body)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Fallo generando imagen con %s: %s", spec.id, redact(exc))
        raise HTTPException(
            504, "El proveedor ha tardado demasiado. Prueba con calidad media."
        )

    if response.status_code >= 400:
        _raise_provider_error(spec, response)

    try:
        payload = response.json()
    except Exception:
        raise HTTPException(502, f"{spec.label} ha devuelto una respuesta ilegible.")

    images = parse_response(payload, final_size)
    if not images:
        raise HTTPException(502, f"{spec.label} no ha devuelto ninguna imagen.")

    return chosen, images


__all__ = [
    "GeneratedImage",
    "SAFEGUARD_SUFFIX",
    "STYLE_SUFFIX",
    "MAX_IMAGES",
    "MAX_PROMPT_CHARS",
    "build_prompt",
    "build_request",
    "generate_image",
    "images_url",
    "normalize_count",
    "normalize_model",
    "normalize_quality",
    "normalize_size",
    "parse_response",
]
