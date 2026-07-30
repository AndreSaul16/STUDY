"""
Redaction — saneado de secretos antes de que toquen un log.

La app es BYOK: la API key del usuario llega en la cabecera ``X-AI-Api-Key``,
se usa para una petición y se tira. El backend NO la persiste, NO la devuelve
y NO la loguea. Este módulo cubre el último caso, que es el más fácil de
incumplir sin querer: basta con un ``logger.exception`` que arrastre el cuerpo
de un 401 del proveedor (algunos hacen eco del prefijo de la key) para que
acabe en los logs de Railway, que son visibles y persisten.

Regla de uso: TODO lo que llegue a ``logger.*`` desde chat_service,
model_catalog, image_service y research_service pasa antes por ``redact``.
"""

from __future__ import annotations

import re
from typing import Any

#: Claves de OpenAI: ``sk-``, ``sk-proj-``, ``sk-svcacct-``… seguidas del
#: cuerpo. El mínimo de 16 evita cazar un "sk-" suelto en prosa.
_OPENAI_KEY = re.compile(r"sk-[A-Za-z0-9_-]{16,}")

#: Claves de Google AI Studio.
_GOOGLE_KEY = re.compile(r"AIza[0-9A-Za-z_-]{20,}")

#: Cabecera Authorization completa (``Bearer <lo que sea>``), por si el
#: proveedor devuelve la petición ecoada.
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")

_MASK = "***"


def redact(value: Any) -> str:
    """
    Devuelve ``value`` como texto con cualquier API key sustituida por ``***``.

    Tolerante a propósito: acepta cualquier cosa (excepciones, dicts, None) y
    devuelve siempre un ``str``. Un fallo aquí no puede impedir que se registre
    el error que se estaba intentando registrar.
    """
    if value is None:
        return ""
    try:
        text = value if isinstance(value, str) else str(value)
    except Exception:  # pragma: no cover - str() de un objeto roto
        return "<no representable>"

    text = _OPENAI_KEY.sub(_MASK, text)
    text = _GOOGLE_KEY.sub(_MASK, text)
    text = _BEARER.sub(f"Bearer {_MASK}", text)
    return text


def contains_secret(value: Any) -> bool:
    """¿Queda algún secreto reconocible en ``value``? Se usa en los tests."""
    if value is None:
        return False
    text = value if isinstance(value, str) else str(value)
    return bool(_OPENAI_KEY.search(text) or _GOOGLE_KEY.search(text))


__all__ = ["redact", "contains_secret"]
