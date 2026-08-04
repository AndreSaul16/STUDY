"""
Schemas de la pestaña de voz.

Aquí solo hay RESPUESTAS: las peticiones que llevan audio son ``multipart/
form-data`` y sus campos se declaran con ``Form``/``File`` en el propio router,
que es como FastAPI las entiende. Modelar el cuerpo con Pydantic obligaría a
mandar el audio en base64 dentro de un JSON, o sea a inflarlo un 33 % y a
cargarlo dos veces en memoria.

Regla heredada de ``ai_settings_schemas``: **ninguna respuesta lleva la API
key**, ni entera ni truncada.
"""

from pydantic import BaseModel
from typing import List, Optional


class PracticeModeDTO(BaseModel):
    """Un tipo de ensayo para el selector. Sin el prompt: eso es interno."""

    id: str
    label: str
    hint: str
    target_seconds: int


class VoiceModesResponse(BaseModel):
    modes: List[PracticeModeDTO]
    default: str


class TranscriptionDTO(BaseModel):
    """Lo que se sacó del audio."""

    text: str
    model: str
    duration_seconds: float
    #: "audio" (la midió el proveedor) · "grabadora" (la declaró el cliente) ·
    #: "desconocida". La interfaz lo enseña porque no valen lo mismo.
    duration_source: str
    language: str = ""


class TranscribeResponse(BaseModel):
    provider: str
    transcription: TranscriptionDTO
    elapsed_ms: int


class PracticeResponse(BaseModel):
    """Transcripción + crítica, y opcionalmente la crítica leída en voz alta."""

    provider: str
    mode: str
    transcription: TranscriptionDTO
    feedback: str
    #: Modelo de chat que escribió la crítica.
    model: str
    target_seconds: int
    #: mp3 en base64. ``None`` cuando no se pidió voz o el proveedor no la
    #: tiene. Va en el mismo JSON en vez de en una segunda petición para no
    #: obligar a reenviar (y volver a pagar) nada.
    audio_b64: Optional[str] = None
    audio_mime: Optional[str] = None
    voice: Optional[str] = None
    elapsed_ms: int


class SpeakRequest(BaseModel):
    """Texto a leer en voz alta. La key va en la cabecera, nunca aquí."""

    text: str
    provider: Optional[str] = None
    model: Optional[str] = None
    voice: Optional[str] = None


class SpeakResponse(BaseModel):
    provider: str
    model: str
    voice: str
    audio_b64: str
    audio_mime: str
    elapsed_ms: int
