"""
Model catalog — el desplegable de modelos, poblado desde el proveedor.

Dos endpoints muy distintos:

* **OpenAI** (``GET /v1/models``) devuelve solo ``{id, created, owned_by}``:
  ni una pista de para qué sirve cada modelo. El filtrado es forzosamente
  heurístico, y está diseñado para **no caducar**: quien filtra de verdad es la
  LISTA NEGRA (audio, embeddings, imagen…), mientras que la lista blanca de
  prefijos solo ORDENA y marca los recomendados. Así un ``gpt-7`` futuro
  aparece solo el día que exista; lo único que pierde es el orden preferente.
* **Google** (``GET /v1beta/models``, endpoint NATIVO) sí da metadatos:
  ``displayName``, ``description``, ``inputTokenLimit`` y
  ``supportedGenerationMethods``. Por eso no se usa aquí la capa de
  compatibilidad: da menos información.

Política de errores, idéntica en ambos:

* 401/403 → error de key **sin eco del cuerpo** (algunos 401 repiten el prefijo
  de la key que se les mandó).
* 429 → mensaje de límite.
* timeout / 5xx / red caída → **no se falla**: se devuelve la lista estática de
  respaldo con ``source="fallback"``. El desplegable nunca se queda vacío,
  porque un desplegable vacío deja al usuario sin poder usar la app.
"""

from __future__ import annotations

import hashlib
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException

from .chat_providers import ProviderSpec
from .redaction import redact

logger = logging.getLogger(__name__)


PURPOSE_CHAT = "chat"
PURPOSE_IMAGE = "image"
PURPOSE_RESEARCH = "research"
_PURPOSES = frozenset({PURPOSE_CHAT, PURPOSE_IMAGE, PURPOSE_RESEARCH})

#: Segundos que vive una lista en caché. Los catálogos cambian cada meses.
CACHE_TTL_SECONDS = 600
#: Tope de entradas con desalojo LRU. Sin tope, un bot probando keys al azar
#: haría crecer el diccionario sin límite.
CACHE_MAX_ENTRIES = 32

HTTP_TIMEOUT_SECONDS = 15.0

_FALLBACK_NOTICE = (
    "No se pudo consultar la lista de modelos del proveedor. "
    "Se muestra una lista básica; puedes escribir otro modelo a mano."
)


# ─── OpenAI: heurística de filtrado ──────────────────────────────
#
# LISTA NEGRA: es la que filtra de verdad. Todo lo que NO sea un modelo de
# conversación de texto.
_EXCLUDE_SUBSTRINGS: Tuple[str, ...] = (
    "audio",
    "realtime",
    "tts",
    "transcribe",
    "whisper",
    "image",
    "embedding",
    "moderation",
    "dall-e",
    "sora",
    "codex",
    "computer-use",
    "guard",
    "-instruct",
    "search-preview",
    "deep-research",
)

# LISTA BLANCA: solo ORDENA. NO excluye. Un modelo que no esté aquí sale
# igualmente, detrás y sin la marca de recomendado.
_PREFERRED_PREFIXES: Tuple[str, ...] = (
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5",
    "o4",
    "o3",
    "gpt-4.1",
    "gpt-4o",
)

#: Los que se marcan con la estrella de "recomendado".
_RECOMMENDED_PREFIXES: Tuple[str, ...] = ("gpt-5.6", "gpt-5.5")

#: Los que razonan (afecta a si el selector de esfuerzo sirve de algo).
_REASONING_PREFIXES: Tuple[str, ...] = ("gpt-5", "o1", "o3", "o4")


# ─── Google: filtrado con metadatos ──────────────────────────────
_GOOGLE_EXCLUDE_SUBSTRINGS: Tuple[str, ...] = (
    "embedding",
    "aqa",
    "imagen",
    "veo",
    "tts",
    "live",
    "robotics",
    "computer-use",
)

_GOOGLE_RECOMMENDED_PREFIXES: Tuple[str, ...] = ("gemini-3.6", "gemini-3.5")

_GOOGLE_MAX_PAGES = 3


@dataclass(frozen=True)
class CatalogResult:
    """Lo que sale del catálogo: la lista y de dónde vino."""

    models: List[Dict[str, Any]]
    source: str
    notice: Optional[str] = None


# ─── Caché ───────────────────────────────────────────────────────
#
# Se cachea el RESULTADO indexado por el hash de la key, jamás la key.
_cache: "OrderedDict[Tuple[str, str, str], Tuple[float, CatalogResult]]" = OrderedDict()


def _cache_key(spec: ProviderSpec, api_key: str, purpose: str) -> Tuple[str, str, str]:
    digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]
    return (spec.id, digest, purpose)


def _cache_get(key: Tuple[str, str, str]) -> Optional[CatalogResult]:
    entry = _cache.get(key)
    if entry is None:
        return None
    stored_at, result = entry
    if time.time() - stored_at > CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return result


def _cache_put(key: Tuple[str, str, str], result: CatalogResult) -> None:
    _cache[key] = (time.time(), result)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


def clear_cache() -> None:
    """Vacía la caché. Existe para los tests, no para producción."""
    _cache.clear()


# ─── Normalización de entradas ───────────────────────────────────


def normalize_purpose(purpose: Optional[str]) -> str:
    """Tolerante: lo que no se reconoce es "chat"."""
    value = str(purpose or "").strip().lower()
    return value if value in _PURPOSES else PURPOSE_CHAT


def _fallback_ids(spec: ProviderSpec, purpose: str) -> Tuple[str, ...]:
    if purpose == PURPOSE_IMAGE:
        return spec.image_models
    if purpose == PURPOSE_RESEARCH:
        return spec.deep_research_models
    return spec.fallback_models


def fallback_result(spec: ProviderSpec, purpose: str, notice: str) -> CatalogResult:
    """Lista estática. El desplegable nunca se queda vacío."""
    ids = _fallback_ids(spec, purpose)
    return CatalogResult(
        models=[_bare_model(spec, model_id, purpose) for model_id in ids],
        source="fallback",
        notice=notice,
    )


def _bare_model(spec: ProviderSpec, model_id: str, purpose: str) -> Dict[str, Any]:
    if spec.id == "google":
        return {
            "id": model_id,
            "label": model_id,
            "description": "",
            "family": _google_family(model_id),
            "reasoning": True,
            "context": None,
            "recommended": model_id.startswith(_GOOGLE_RECOMMENDED_PREFIXES),
        }
    return {
        "id": model_id,
        "label": model_id,
        "description": "",
        "family": _openai_family(model_id),
        "reasoning": model_id.startswith(_REASONING_PREFIXES),
        "context": None,
        "recommended": model_id.startswith(_RECOMMENDED_PREFIXES),
    }


# ─── OpenAI ──────────────────────────────────────────────────────


def _openai_family(model_id: str) -> str:
    head = model_id.split("-")
    if len(head) >= 2 and head[0] in {"gpt", "o1", "o3", "o4"}:
        return "-".join(head[:2]) if head[0] == "gpt" else head[0]
    return head[0] if head else ""


def _preferred_rank(model_id: str) -> int:
    for index, prefix in enumerate(_PREFERRED_PREFIXES):
        if model_id.startswith(prefix):
            return index
    return len(_PREFERRED_PREFIXES)


def parse_openai_models(
    payload: Dict[str, Any], spec: ProviderSpec, purpose: str
) -> List[Dict[str, Any]]:
    """
    Convierte ``{"data":[{id, created, ...}]}`` en la lista del desplegable.

    Para ``purpose`` distinto de "chat" se cruza con la lista corta de la
    ficha del proveedor: los modelos de imagen y de deep research están
    identificados por nombre y no queremos que la heurística los adivine (ni
    que se cuele ``gpt-image-1``, que se deprecia).
    """
    raw = payload.get("data") if isinstance(payload, dict) else None
    entries = [item for item in (raw or []) if isinstance(item, dict)]

    if purpose != PURPOSE_CHAT:
        allowed = _fallback_ids(spec, purpose)
        present = {str(item.get("id", "")) for item in entries}
        return [
            _bare_model(spec, model_id, purpose)
            for model_id in allowed
            if not present or model_id in present
        ]

    kept: List[Tuple[int, int, Dict[str, Any]]] = []
    for item in entries:
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        lowered = model_id.lower()
        if any(bad in lowered for bad in _EXCLUDE_SUBSTRINGS):
            continue

        created = item.get("created")
        created_at = int(created) if isinstance(created, (int, float)) else 0
        kept.append((_preferred_rank(lowered), -created_at, _bare_model(spec, model_id, purpose)))

    kept.sort(key=lambda row: (row[0], row[1], row[2]["id"]))
    return [row[2] for row in kept]


# ─── Google ──────────────────────────────────────────────────────


def _google_family(model_id: str) -> str:
    parts = model_id.split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else model_id


def parse_google_models(
    pages: List[Dict[str, Any]], spec: ProviderSpec, purpose: str
) -> List[Dict[str, Any]]:
    """
    Convierte las páginas de ``/v1beta/models`` en la lista del desplegable.

    Aquí sí hay metadatos, así que el filtro es semántico y no adivinatorio:
    entra lo que declare ``generateContent``. Los ``*-image`` se apartan al
    ``purpose="image"``: no pintan nada en el selector de chat.
    """
    models: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for page in pages:
        for item in (page.get("models") if isinstance(page, dict) else None) or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            model_id = name.split("/", 1)[1] if name.startswith("models/") else name
            model_id = model_id.strip()
            if not model_id or model_id in seen:
                continue

            methods = item.get("supportedGenerationMethods")
            methods = methods if isinstance(methods, list) else []
            if "generateContent" not in methods:
                continue

            lowered = model_id.lower()
            if any(bad in lowered for bad in _GOOGLE_EXCLUDE_SUBSTRINGS):
                continue

            is_image = lowered.endswith("-image") or "-image-" in lowered
            if (purpose == PURPOSE_IMAGE) != is_image:
                continue

            seen.add(model_id)
            context = item.get("inputTokenLimit")
            models.append(
                {
                    "id": model_id,
                    "label": str(item.get("displayName") or model_id),
                    "description": str(item.get("description") or ""),
                    "family": _google_family(lowered),
                    "reasoning": True,
                    "context": int(context) if isinstance(context, int) else None,
                    "recommended": lowered.startswith(_GOOGLE_RECOMMENDED_PREFIXES),
                }
            )

    models.sort(key=lambda m: (not m["recommended"], m["id"]))
    return models


# ─── Acceso HTTP ─────────────────────────────────────────────────


def _auth_headers(spec: ProviderSpec, api_key: str) -> Dict[str, str]:
    if spec.key_header.lower() == "authorization":
        return {"Authorization": f"Bearer {api_key}"}
    return {spec.key_header: api_key}


def _raise_for_key(spec: ProviderSpec, status: int) -> None:
    """
    Traduce el error del proveedor SIN reenviar su cuerpo.

    Algunos 401 hacen eco del prefijo de la key que se les mandó; devolverlo
    tal cual la escupiría en la interfaz y en cualquier informe de error.
    """
    if status in (401, 403):
        raise HTTPException(401, f"La API key no es válida para {spec.label}.")
    if status == 429:
        raise HTTPException(
            429, "El proveedor está limitando las peticiones. Prueba en un minuto."
        )


async def _fetch_openai(
    spec: ProviderSpec, api_key: str, purpose: str, client: httpx.AsyncClient
) -> CatalogResult:
    response = await client.get(spec.models_url, headers=_auth_headers(spec, api_key))
    _raise_for_key(spec, response.status_code)
    response.raise_for_status()
    models = parse_openai_models(response.json(), spec, purpose)
    if not models:
        return fallback_result(spec, purpose, _FALLBACK_NOTICE)
    return CatalogResult(models=models, source="api")


async def _fetch_google(
    spec: ProviderSpec, api_key: str, purpose: str, client: httpx.AsyncClient
) -> CatalogResult:
    pages: List[Dict[str, Any]] = []
    params: Dict[str, Any] = {"pageSize": 200}

    for _ in range(_GOOGLE_MAX_PAGES):
        response = await client.get(
            spec.models_url, headers=_auth_headers(spec, api_key), params=params
        )
        _raise_for_key(spec, response.status_code)
        response.raise_for_status()
        payload = response.json()
        pages.append(payload if isinstance(payload, dict) else {})

        token = payload.get("nextPageToken") if isinstance(payload, dict) else None
        if not token:
            break
        params = {"pageSize": 200, "pageToken": token}

    models = parse_google_models(pages, spec, purpose)
    if not models:
        return fallback_result(spec, purpose, _FALLBACK_NOTICE)
    return CatalogResult(models=models, source="api")


async def list_models(
    spec: ProviderSpec, api_key: str, purpose: str = PURPOSE_CHAT
) -> CatalogResult:
    """
    Lista los modelos de ``spec`` con la key dada.

    Es además el test de validez de la key: si el proveedor devuelve la lista,
    la key sirve. Por eso no hace falta un ``/validate`` aparte.
    """
    purpose = normalize_purpose(purpose)
    key = (api_key or "").strip()
    if not key:
        return fallback_result(
            spec, purpose, "Añade tu API key para ver los modelos de tu cuenta."
        )

    cache_key = _cache_key(spec, key, purpose)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            if spec.id == "google":
                result = await _fetch_google(spec, key, purpose, client)
            else:
                result = await _fetch_openai(spec, key, purpose, client)
    except HTTPException:
        # Key inválida o límite: son errores del usuario, se propagan tal cual
        # (ya saneados) para que la interfaz pueda decir qué pasa.
        raise
    except Exception as exc:
        # Red, timeout o 5xx: el proveedor está mal, no el usuario. Degradar.
        logger.warning(
            "No se pudo listar modelos de %s: %s", spec.id, redact(exc)
        )
        return fallback_result(spec, purpose, _FALLBACK_NOTICE)

    if result.source == "api":
        _cache_put(cache_key, result)
    return result


__all__ = [
    "CatalogResult",
    "PURPOSE_CHAT",
    "PURPOSE_IMAGE",
    "PURPOSE_RESEARCH",
    "clear_cache",
    "fallback_result",
    "list_models",
    "normalize_purpose",
    "parse_google_models",
    "parse_openai_models",
]
