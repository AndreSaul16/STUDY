"""Routers package."""

from .ai_router import router as ai_router
from .interop_router import router as interop_router
from .jwpub_router import router as jwpub_router
from .chat_router import router as chat_router
from .jw_router import router as jw_router
from .references_router import router as references_router

__all__ = [
    "ai_router",
    "interop_router",
    "jwpub_router",
    "chat_router",
    "jw_router",
    "references_router",
]
