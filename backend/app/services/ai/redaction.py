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


#: Mensajes del proveedor que el usuario PUEDE accionar. Se le enseñan tal
#: cual (ya redactados) en vez de esconderlos tras "Error al conectar".
#:
#: Por qué existe: durante media hora se estuvo adivinando por qué Google no
#: respondía, porque el chat decía siempre lo mismo pasara lo que pasara. La
#: causa real —un modelo que no existe, un parámetro que ese proveedor no
#: admite— venía escrita en la respuesta del proveedor y se estaba tirando a
#: la basura. Un error genérico es cómodo de escribir y carísimo de depurar.
_ACCIONABLES = (
    ("model", "does not exist", "Ese modelo no existe o tu cuenta no tiene acceso."),
    ("model_not_found", "", "Ese modelo no existe o tu cuenta no tiene acceso."),
    ("invalid_api_key", "", "La API key no es válida para este proveedor."),
    ("Please pass a valid API key", "", "La API key no es válida para este proveedor."),
    ("authorized_error", "", "La API key no es válida para este proveedor."),
    ("insufficient_quota", "", "Tu cuenta no tiene saldo o ha agotado la cuota."),
    ("rate_limit", "", "El proveedor está limitando las peticiones. Prueba en un minuto."),
    ("context_length", "", "La conversación es demasiado larga para este modelo."),
)


def provider_error_message(spec: Any, exc: BaseException) -> str:
    """
    Mensaje de error del chat: concreto cuando se puede, genérico si no.

    Nombra al proveedor SIEMPRE. "Error al conectar con el proveedor de IA" no
    dice si el problema es la key, el modelo o el saldo, y con tres proveedores
    configurables ni siquiera dice cuál falló.

    Pasa por ``redact`` antes de salir: la excepción de un SDK puede llevar la
    petición entera, y ahí dentro va la API key.
    """
    etiqueta = getattr(spec, "label", None) or getattr(spec, "id", "el proveedor")
    detalle = redact(exc)

    for aguja, extra, explicacion in _ACCIONABLES:
        if aguja in detalle and (not extra or extra in detalle):
            return f"{etiqueta}: {explicacion}"

    # Sin patrón conocido se da el texto del proveedor, recortado. Es feo, pero
    # es la diferencia entre poder arreglarlo y tener que adivinar.
    resumen = " ".join(detalle.split())[:180]
    return f"Error de {etiqueta}. {resumen}" if resumen else f"Error de {etiqueta}."


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


__all__ = ["redact", "contains_secret", "provider_error_message"]
