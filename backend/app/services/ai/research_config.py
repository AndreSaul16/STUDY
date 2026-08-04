"""
Configuración de investigación — qué se le permite al agente en esta petición.

Un solo objeto que viaja del cliente al backend y de ahí a las herramientas.

**Un solo interruptor de cara al usuario: ``internet``.** Hubo cuatro y sobraban
tres. Los otros no eran decisiones de uso, eran raíles de seguridad disfrazados
de preferencia: el bloqueo de material apostata y el aviso de que una
publicación tiene treinta años no son cosas que convenga poder apagar por
descuido desde una pantalla de ajustes, y ofrecerlas como opción sugería que
apagarlas era una alternativa razonable. Ahora van SIEMPRE puestos.

Lo que queda configurable es lo único que cambia de verdad el comportamiento y
tiene un coste que el usuario debe aceptar a sabiendas: si el agente puede
salir de jw.org o no.

Se pasa por parámetro y NUNCA por variable global ni de módulo: el backend
atiende varias peticiones a la vez y la configuración de una no puede
encenderle internet a otra.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

#: Ámbitos de la búsqueda externa.
#:   cientifico → solo catálogos académicos (OpenAlex, Europe PMC)
#:   ampliado   → añade webs de referencia, si hay buscador configurado
SCOPES = ("cientifico", "ampliado")
DEFAULT_SCOPE = "cientifico"

_MAX_RESULTS_CEILING = 12


def _as_bool(value: Any, default: bool) -> bool:
    """Tolerante: el cliente puede mandar "true", 1 o nada."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "si", "sí", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass(frozen=True)
class ResearchConfig:
    """Lo que el usuario ha decidido para esta investigación."""

    internet: bool = True
    """
    ¿Puede el agente salir de jw.org a buscar datos?

    El ÚNICO ajuste que ve el usuario. Los demás campos existen para el motor,
    no para una pantalla de opciones.
    """

    scope: str = DEFAULT_SCOPE
    """
    Hasta dónde llega esa salida.

    Ya no se elige: se deduce de lo que haya configurado en el servidor. Si hay
    un buscador web con clave se aprovecha, y si no, la búsqueda es solo
    académica. Preguntárselo al usuario era pedirle que decidiera sobre una
    capacidad que ni siquiera sabe si está instalada.
    """

    min_year: Optional[int] = None
    """Suelo de antigüedad por defecto para las búsquedas. ``None`` = sin suelo."""

    max_results: int = 6
    """Resultados por búsqueda externa."""

    #: El bloqueo de material apostata y los avisos de antigüedad NO son
    #: configurables. Son raíles, no preferencias: apagarlos no mejora ningún
    #: caso de uso y ofrecerlos como opción sugiere que hacerlo es razonable.
    doctrinal_filter: bool = True
    date_warnings: bool = True

    @property
    def allows_general_web(self) -> bool:
        """
        Si hay buscador web configurado, se usa.

        No depende ya del ``scope`` elegido por el usuario: el ámbito lo marca
        lo que el servidor tenga instalado, y ``web_search`` comprueba la clave
        antes de intentarlo.
        """
        return self.internet

    @classmethod
    def offline(cls) -> "ResearchConfig":
        """Sin salir de jw.org. Lo que se usa en el chat normal."""
        return cls(internet=False)

    @classmethod
    def from_payload(cls, payload: Any) -> "ResearchConfig":
        """
        Construye la configuración desde lo que mandó el cliente.

        Tolerante igual que ``get_mode`` y ``get_provider``: un cliente antiguo
        no manda nada y recibe los valores por defecto; un valor raro degrada al
        default en vez de devolver un 422 que rompería el turno entero.

        ``doctrinal_filter`` y ``date_warnings`` se ignoran vengan como vengan:
        un cliente no puede apagar un raíl de seguridad mandando un booleano.
        """
        if payload is None:
            return cls()
        data = payload if isinstance(payload, dict) else getattr(payload, "__dict__", {})
        if not isinstance(data, dict):
            return cls()

        scope = str(data.get("scope") or DEFAULT_SCOPE).strip().lower()
        if scope not in SCOPES:
            scope = DEFAULT_SCOPE

        try:
            max_results = int(data.get("max_results") or 6)
        except (TypeError, ValueError):
            max_results = 6

        min_year = data.get("min_year")
        try:
            min_year = int(min_year) if min_year not in (None, "") else None
        except (TypeError, ValueError):
            min_year = None

        return cls(
            internet=_as_bool(data.get("internet"), True),
            scope=scope,
            min_year=min_year,
            max_results=max(1, min(max_results, _MAX_RESULTS_CEILING)),
        )

    def to_dict(self) -> dict:
        return {
            "internet": self.internet,
            "scope": self.scope,
            "min_year": self.min_year,
            "max_results": self.max_results,
        }


__all__ = ["DEFAULT_SCOPE", "SCOPES", "ResearchConfig"]
