"""Servicio de resolución de referencias (escrituras) contra WOL en español."""

from .reference_resolver import (
    ReferenceResolutionError,
    ResolvedReference,
    resolve_reference,
)

__all__ = [
    "ReferenceResolutionError",
    "ResolvedReference",
    "resolve_reference",
]
