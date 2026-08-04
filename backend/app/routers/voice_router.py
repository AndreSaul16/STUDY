"""
Voice Router — practicar hablando.

GET  /api/voice/modes      — catálogo de tipos de ensayo (estático, sin key)
POST /api/voice/transcribe — audio → texto
POST /api/voice/practice   — audio → texto + crítica (+ crítica hablada)
POST /api/voice/speak      — texto → audio

La API key del usuario llega SOLO por la cabecera ``X-AI-Api-Key``, igual que
en el chat y en las imágenes: nunca por query string (quedaría en los logs del
proxy y en el historial del navegador) y nunca dentro del multipart, que es
justo lo que se registra al depurar una subida. Se usa para esta petición y se
descarta: no se persiste, no se loguea y no vuelve en ninguna respuesta.

Los bytes del audio NO tocan el disco del backend, por lo mismo que las
imágenes: el contenedor de Railway tiene filesystem efímero y la app no tiene
autenticación, así que cualquier almacén aquí sería temporal y compartido.
"""

import base64
import logging
import time

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from typing import Optional

from ..schemas.voice_schemas import (
    PracticeModeDTO,
    PracticeResponse,
    SpeakRequest,
    SpeakResponse,
    TranscribeResponse,
    TranscriptionDTO,
    VoiceModesResponse,
)
from ..services.ai.chat_providers import (
    ProviderSpec,
    build_runtime,
    get_provider,
    server_api_key,
)
from ..services.ai.voice_service import (
    DEFAULT_PRACTICE,
    MAX_AUDIO_BYTES,
    TTS_MIME,
    critique,
    get_practice,
    list_practices,
    normalize_target_seconds,
    synthesize,
    transcribe,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


def _resolve_key(spec: ProviderSpec, header_key: Optional[str]) -> str:
    """
    Key de esta petición: la del usuario manda, la del servidor rescata.

    Mismo criterio que ``images_router``: sin configurar nada la app sigue
    funcionando si el backend tiene su propia key.
    """
    return (header_key or "").strip() or server_api_key(spec)


async def _read_audio(audio: UploadFile) -> bytes:
    """
    Lee la subida con el tope puesto DURANTE la lectura, no después.

    Leer entero y medir luego significa que un fichero de 2 GB ya se ha comido
    la RAM del contenedor antes de que nadie lo rechace. Se lee a trozos y se
    corta en cuanto se pasa: el atacante paga el ancho de banda, nosotros no
    pagamos la memoria.
    """
    trozos = bytearray()
    while True:
        trozo = await audio.read(256 * 1024)
        if not trozo:
            break
        trozos.extend(trozo)
        if len(trozos) > MAX_AUDIO_BYTES:
            megas = MAX_AUDIO_BYTES // (1024 * 1024)
            raise HTTPException(
                413,
                f"La grabación pasa de {megas} MB. Divide el ensayo en partes "
                "más cortas.",
            )
    return bytes(trozos)


def _declared_seconds(duration_ms: Optional[float]) -> Optional[float]:
    """Milisegundos del cronómetro del cliente → segundos, o ``None``."""
    if duration_ms is None:
        return None
    try:
        value = float(duration_ms)
    except (TypeError, ValueError):
        return None
    return value / 1000.0 if value > 0 else None


@router.get("/modes", response_model=VoiceModesResponse)
async def voice_modes() -> VoiceModesResponse:
    """
    Catálogo de tipos de ensayo.

    Sin key y sin red, igual que ``/api/chat/modes``: el selector se tiene que
    poder pintar aunque no haya nada configurado y el proveedor esté caído.
    """
    return VoiceModesResponse(
        modes=[PracticeModeDTO(**mode) for mode in list_practices()],
        default=DEFAULT_PRACTICE,
    )


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    provider: Optional[str] = Form(default=None),
    model: Optional[str] = Form(default=None),
    language: str = Form(default="es"),
    duration_ms: Optional[float] = Form(default=None),
    x_ai_api_key: Optional[str] = Header(default=None, alias="X-AI-Api-Key"),
) -> TranscribeResponse:
    """Transcribe una grabación y devuelve el texto. Sin crítica y sin coste de chat."""
    spec = get_provider(provider)
    started = time.time()

    data = await _read_audio(audio)
    result = await transcribe(
        spec,
        _resolve_key(spec, x_ai_api_key),
        data,
        audio.filename or "",
        model=model,
        language=language,
        declared_seconds=_declared_seconds(duration_ms),
    )

    return TranscribeResponse(
        provider=spec.id,
        transcription=TranscriptionDTO(**result.to_dict()),
        elapsed_ms=int((time.time() - started) * 1000),
    )


@router.post("/practice", response_model=PracticeResponse)
async def practice(
    audio: UploadFile = File(...),
    mode: Optional[str] = Form(default=None),
    provider: Optional[str] = Form(default=None),
    model: Optional[str] = Form(default=None),
    stt_model: Optional[str] = Form(default=None),
    effort: Optional[str] = Form(default=None),
    language: str = Form(default="es"),
    duration_ms: Optional[float] = Form(default=None),
    target_seconds: Optional[float] = Form(default=None),
    notes: str = Form(default=""),
    speak: bool = Form(default=False),
    voice: Optional[str] = Form(default=None),
    x_ai_api_key: Optional[str] = Header(default=None, alias="X-AI-Api-Key"),
) -> PracticeResponse:
    """
    El endpoint de la pestaña: escucha el ensayo y devuelve la crítica.

    UN solo proveedor para las tres llamadas (transcribir, criticar y, si se
    pide, hablar) a propósito. Repartirlas entre proveedores obligaría a
    manejar dos keys en la misma petición para ahorrar unos céntimos, y una
    pantalla en la que "el proveedor de voz" y "el proveedor del texto" son
    cosas distintas es una pantalla que nadie configura bien.

    La voz de vuelta es OPCIONAL y por defecto va apagada: cuesta dinero, y
    quien está ensayando de pie suele querer leer la crítica, no escuchar otro
    audio encima.
    """
    spec = get_provider(provider)
    api_key = _resolve_key(spec, x_ai_api_key)
    practice_spec = get_practice(mode)
    started = time.time()

    data = await _read_audio(audio)
    transcription = await transcribe(
        spec,
        api_key,
        data,
        audio.filename or "",
        model=stt_model,
        language=language,
        declared_seconds=_declared_seconds(duration_ms),
    )

    objetivo = normalize_target_seconds(target_seconds, practice_spec)

    # La crítica sale del cliente de chat del MISMO proveedor. `build_runtime`
    # ya sabe montar el AsyncOpenAI con su base_url y traducir el esfuerzo, así
    # que aquí no hay ni un `if` por proveedor.
    runtime = build_runtime(
        spec.id,
        api_key,
        model=model,
        effort=effort,
        source="client" if (x_ai_api_key or "").strip() else "server",
    )

    feedback = await critique(
        runtime.client,
        runtime.model,
        practice_spec,
        transcription,
        objetivo,
        notes=notes,
        answer_params=runtime.answer_params,
    )

    audio_b64: Optional[str] = None
    audio_mime: Optional[str] = None
    voz: Optional[str] = None

    # Que falle la voz no puede tirar la crítica: el trabajo caro (transcribir
    # y razonar) ya está hecho y pagado. Se devuelve sin audio y la interfaz
    # enseña el texto igual.
    if speak and spec.supports_tts and feedback:
        try:
            _, voz, raw = await synthesize(spec, api_key, feedback, voice=voice)
            audio_b64 = base64.b64encode(raw).decode("ascii")
            audio_mime = TTS_MIME
        except HTTPException as exc:
            logger.info("Crítica sin voz (%s): %s", spec.id, exc.detail)
            voz = None

    return PracticeResponse(
        provider=spec.id,
        mode=practice_spec.id,
        transcription=TranscriptionDTO(**transcription.to_dict()),
        feedback=feedback,
        model=runtime.model,
        target_seconds=objetivo,
        audio_b64=audio_b64,
        audio_mime=audio_mime,
        voice=voz,
        elapsed_ms=int((time.time() - started) * 1000),
    )


@router.post("/speak", response_model=SpeakResponse)
async def speak(
    body: SpeakRequest,
    x_ai_api_key: Optional[str] = Header(default=None, alias="X-AI-Api-Key"),
) -> SpeakResponse:
    """
    Lee un texto en voz alta.

    Existe aparte de ``/practice`` para poder oír una crítica que ya se pidió
    sin voz, sin volver a subir el audio ni a pagar la transcripción.

    Devuelve base64 dentro de un JSON en lugar de un ``Response`` binario para
    que el cliente pueda guardarlo junto al resto del turno con un solo
    contrato, igual que hacen las imágenes.
    """
    spec = get_provider(body.provider)
    started = time.time()

    model, voz, raw = await synthesize(
        spec,
        _resolve_key(spec, x_ai_api_key),
        body.text,
        model=body.model,
        voice=body.voice,
    )

    return SpeakResponse(
        provider=spec.id,
        model=model,
        voice=voz,
        audio_b64=base64.b64encode(raw).decode("ascii"),
        audio_mime=TTS_MIME,
        elapsed_ms=int((time.time() - started) * 1000),
    )


__all__ = ["router"]
