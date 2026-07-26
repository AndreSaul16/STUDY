"""Servicio de resolución de referencias (escrituras) contra WOL en español."""

from .reference_resolver import (
    BibleChapter,
    ReferenceResolutionError,
    ResolvedReference,
    fetch_chapter,
    resolve_reference,
)

__all__ = [
    "BibleChapter",
    "ReferenceResolutionError",
    "ResolvedReference",
    "fetch_chapter",
    "resolve_reference",
]
