"""
Voice service — ensayar en voz alta y recibir una crítica útil.

Encaje de producto (decisión antes que código): esto NO es "el chat pero
dictado". El chat redacta por ti; aquí ya has escrito tú y lo que quieres es
saber cómo ha sonado. Por eso la salida no es una pieza sino una crítica, y por
eso el prompt no es el del chat: no lleva la política de investigación, porque
en esta pantalla NO hay herramientas y un modelo al que se le ordena buscar
antes de contestar, sin herramientas que llamar, se queda bloqueado pidiendo
permiso.

QUÉ SE VERIFICÓ Y CÓMO (2026-08-02, llamadas reales con la key de backend/.env)

  OpenAI — soportado
    · POST https://api.openai.com/v1/audio/transcriptions
      200 · application/json · {"text": "…", "usage": {…}}
      Probado con whisper-1, gpt-4o-mini-transcribe y gpt-4o-transcribe, y con
      un contenedor WebM/Opus real (cabecera EBML 1A 45 DF A3) generado con
      ffmpeg, que es exactamente lo que produce MediaRecorder en Chrome.
      Con `response_format=verbose_json`, whisper-1 añade `duration` (6.5) y
      `segments`. gpt-4o-mini-transcribe responde 400 a verbose_json
      ("response_format 'verbose_json' is not compatible with model …"), de ahí
      que la duración sea capacidad por MODELO y no por proveedor.
    · POST https://api.openai.com/v1/audio/speech
      200 · audio/mpeg · con gpt-4o-mini-tts, tts-1 y tts-1-hd, y con las trece
      voces una por una. Formatos comprobados: mp3, opus, aac, wav y pcm.
    · Tope de subida REAL del proveedor: se mandaron 26 MB y contestó
      413 "Maximum content size limit (26214400) exceeded", o sea 25 MiB
      exactos. Nuestro tope va por debajo a propósito (ver MAX_AUDIO_BYTES).

  Google — NO soportado, y no por pereza
    · …/v1beta/openai/audio/transcriptions y …/audio/speech → 404 con cuerpo
      vacío. Control con la misma petición contra …/openai/chat/completions →
      400 "Please pass a valid API key". El 404 es la ruta, no la auth: la capa
      compatible de Google no implementa /audio/*.

  MiniMax — NO soportado
    · /v1/audio/transcriptions y /v1/audio/speech → 404 "404 page not found".
      Control: /v1/chat/completions → 401. Su TTS nativo /v1/t2a_v2 sí existe
      (200 con base_resp 1004 "login fail"), pero es otro contrato y en este
      entorno no hay key con la que comprobar la forma de la respuesta.

  Sin comprobar: la calidad de la transcripción con ruido de fondo o con voz
  lejana (se probó con audio sintético limpio), y el comportamiento con
  grabaciones largas de verdad (la más larga que se transcribió fueron 7 s).

La API key NO se guarda, NO se loguea y NO vuelve en ninguna respuesta: entra
por la cabecera, se usa para una llamada y muere con el cliente HTTP.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException

from .chat_providers import ProviderSpec
from .redaction import redact
from .style_guide import IDENTITY, VOICE_GUIDE

logger = logging.getLogger(__name__)


# ─── Límites de la subida ────────────────────────────────────────
#
# Un endpoint que acepta subidas sin tope es un problema aunque el proveedor
# tenga el suyo: el audio se lee ENTERO en memoria antes de reenviarlo, así que
# el tope de verdad lo marca la RAM del contenedor de Railway, no la API de
# OpenAI. Se corta en 20 MiB, por debajo de los 26214400 bytes que el proveedor
# rechaza con 413, para que el mensaje de error sea nuestro y esté en español
# en vez de un 413 críptico traducido de rebote.

MAX_AUDIO_BYTES = 20 * 1024 * 1024

#: Por debajo de esto no hay voz: es un botón pulsado y soltado sin querer.
#: Un WebM/Opus de un segundo ronda los 4 KB, así que 1 KB no descarta nada
#: aprovechable y sí evita gastar una llamada en un fichero vacío.
MIN_AUDIO_BYTES = 1024

#: Quince minutos. Es lo que dura la parte más larga que alguien ensaya de una
#: sentada; más que eso casi siempre es una grabación que se quedó abierta.
MAX_AUDIO_SECONDS = 15 * 60

#: Segundos. Transcribir 10 minutos tarda bastante más que generar una imagen,
#: y el usuario ya ha invertido el tiempo de grabarlo: cortar aquí sería tirar
#: su ensayo a la basura.
HTTP_TIMEOUT_SECONDS = 300.0

#: Extensión → mime que se le declara al proveedor. La lista es la que la API
#: documenta y la que MediaRecorder produce de verdad (webm en Chrome y
#: Firefox, mp4/m4a en Safari). Un formato fuera de esto se rechaza aquí en vez
#: de gastar la llamada para que el proveedor conteste 400.
AUDIO_MIME_BY_SUFFIX: Dict[str, str] = {
    "webm": "audio/webm",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "mp3": "audio/mpeg",
    "mpga": "audio/mpeg",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mpeg": "audio/mpeg",
}

DEFAULT_AUDIO_SUFFIX = "webm"

#: Formato de la respuesta hablada. mp3 y no wav porque el wav de la misma
#: frase pesaba 64 844 bytes frente a 5 760: en un móvil con datos eso importa.
TTS_FORMAT = "mp3"
TTS_MIME = "audio/mpeg"

_OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions"
_OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech"

#: Tope de la crítica. Es un comentario sobre un ensayo, no otro discurso.
FEEDBACK_MAX_TOKENS = 1100

#: Tope del texto que se manda a sintetizar. El endpoint documenta 4096
#: caracteres; se corta antes para que el recorte lo hagamos nosotros por una
#: frontera de frase y no el proveedor por la mitad de una palabra.
MAX_TTS_CHARS = 3800


# ─── Modos de práctica ───────────────────────────────────────────


@dataclass(frozen=True)
class PracticeSpec:
    """
    Un tipo de ensayo. Pariente de ``ModeSpec`` del chat, pero al revés: allí
    la plantilla describe lo que hay que ESCRIBIR, aquí describe qué hay que
    ESCUCHAR.
    """

    id: str
    label: str
    hint: str
    """Qué se espera que el usuario haga antes de darle a grabar."""
    prompt: str
    """Criterios de evaluación propios de este tipo de parte."""
    target_seconds: int
    """
    Duración habitual, para que la crítica pueda comparar sin preguntar. El
    cliente puede sobrescribirla: quien prepara una parte de 10 minutos no
    debería tener que elegir otro modo para que le cuadren los tiempos.
    """

    def to_dict(self) -> Dict[str, Any]:
        """DTO para el cliente. El ``prompt`` NO viaja: es interno."""
        return {
            "id": self.id,
            "label": self.label,
            "hint": self.hint,
            "target_seconds": self.target_seconds,
        }


_DISCURSO = """\
### QUÉ MIRAS EN UN DISCURSO O UNA PARTE

- ¿Se entiende el tema en los primeros veinte segundos, o hay preámbulo?
- ¿Los puntos se distinguen al oírlos? En papel se ven los números; hablando,
  solo se notan si hay una transición que los marque.
- ¿Leyó el pasaje y **lo aplicó**? Leer un texto y seguir adelante sin decir
  qué hacía ahí es el fallo más repetido: señálalo cuando pase.
- ¿La conclusión aterriza en algo que el auditorio pueda hacer, o se apaga?
- Si abrió con una ilustración, ¿seguía viva al final o la abandonó?\
"""


_PREDICACION = """\
### QUÉ MIRAS EN UNA PRESENTACIÓN DE PREDICACIÓN

- ¿Suena a conversación o a texto recitado? Aquí es lo que más se nota.
- ¿La primera frase da una razón para seguir escuchando, o va directa al
  ofrecimiento?
- ¿Hay una pregunta que invite a responder, y deja sitio para esa respuesta?
- ¿Cabe en el tiempo que dura alguien de pie en su puerta? Treinta o cuarenta
  segundos hasta el primer turno del otro.
- ¿Cierra dejando puerta abierta para la revisita, con algo concreto?\
"""


_LECTURA = """\
### QUÉ MIRAS EN UNA LECTURA DE LA BIBLIA

- Ritmo: ¿corre en las frases largas? ¿Se come el final de los versículos?
- Énfasis: ¿destaca la palabra que sostiene el sentido, o acentúa por inercia?
- Pausas: ¿respeta la puntuación, o encadena dos ideas sin respirar?
- Nombres propios y cifras: si se traba en alguno, dilo con la palabra exacta.
- Naturalidad: leer bien es sonar a alguien contando algo, no a locutor.\
"""


_COMENTARIO = """\
### QUÉ MIRAS EN UN COMENTARIO DE REUNIÓN

- Treinta segundos son unas 75 palabras. Pasarse es el error clásico.
- ¿Una sola idea, o intenta meter tres?
- ¿Se apoya en una expresión concreta del párrafo o del texto, citada?
- ¿Termina en algo aplicable, o se queda en repetir la respuesta del párrafo?\
"""


_LIBRE = """\
### ENSAYO LIBRE

No hay plantilla que aplicar. Escucha lo que ha querido hacer y evalúa eso
mismo: si era explicar algo, si se entendió; si era animar, si anima. Di al
principio, en media línea, qué has entendido que estaba practicando, para que
pueda corregirte si te has equivocado.\
"""


PRACTICE_MODES: Dict[str, PracticeSpec] = {
    "discurso": PracticeSpec(
        id="discurso",
        label="Discurso o parte",
        hint="Ensaya la parte entera, con las pausas de verdad",
        prompt=_DISCURSO,
        target_seconds=5 * 60,
    ),
    "predicacion": PracticeSpec(
        id="predicacion",
        label="Presentación de predicación",
        hint="Di la presentación como se la dirías a la persona",
        prompt=_PREDICACION,
        target_seconds=45,
    ),
    "lectura": PracticeSpec(
        id="lectura",
        label="Lectura de la Biblia",
        hint="Lee el pasaje en voz alta, sin correr",
        prompt=_LECTURA,
        target_seconds=4 * 60,
    ),
    "comentario": PracticeSpec(
        id="comentario",
        label="Comentario de 30 s",
        hint="Suelta el comentario como lo dirías en la reunión",
        prompt=_COMENTARIO,
        target_seconds=30,
    ),
    "libre": PracticeSpec(
        id="libre",
        label="Ensayo libre",
        hint="Habla de lo que quieras practicar",
        prompt=_LIBRE,
        target_seconds=0,
    ),
}

DEFAULT_PRACTICE = "discurso"


def get_practice(practice_id: Optional[str]) -> PracticeSpec:
    """
    ``PracticeSpec`` de ``practice_id``.

    Tolerante igual que ``get_mode`` y ``get_provider``, y por la misma razón:
    un id desconocido degrada al modo por defecto en vez de devolver un 422 que
    tiraría un ensayo que el usuario ya ha grabado. Perder la grabación por un
    id mal escrito sería el peor final posible de esta pantalla.
    """
    if not practice_id:
        return PRACTICE_MODES[DEFAULT_PRACTICE]
    key = str(practice_id).strip().lower()
    return PRACTICE_MODES.get(key, PRACTICE_MODES[DEFAULT_PRACTICE])


def list_practices() -> List[Dict[str, Any]]:
    """Catálogo para ``GET /api/voice/modes``. Sin los prompts."""
    return [spec.to_dict() for spec in PRACTICE_MODES.values()]


# ─── Normalización (pura, testeable sin red) ─────────────────────


def normalize_stt_model(spec: ProviderSpec, model: Optional[str]) -> str:
    """
    Modelo de transcripción válido para ``spec``.

    Lista cerrada por el mismo motivo que en las imágenes: los ids son pocos y
    conocidos, y dejar pasar cualquier cadena solo produce 400 del proveedor
    después de haber subido varios megas de audio.
    """
    value = str(model or "").strip()
    if value in spec.stt_models:
        return value
    return spec.stt_models[0] if spec.stt_models else ""


def normalize_tts_model(spec: ProviderSpec, model: Optional[str]) -> str:
    value = str(model or "").strip()
    if value in spec.tts_models:
        return value
    return spec.tts_models[0] if spec.tts_models else ""


def normalize_voice(spec: ProviderSpec, voice: Optional[str]) -> str:
    value = str(voice or "").strip().lower()
    if value in spec.tts_voices:
        return value
    return spec.tts_voices[0] if spec.tts_voices else ""


def normalize_suffix(filename: Optional[str]) -> str:
    """
    Extensión limpia del fichero subido.

    Se mira la extensión y no el ``content-type`` que declara el navegador
    porque MediaRecorder manda cosas como ``audio/webm;codecs=opus``, y porque
    un cliente cualquiera puede mandar ``application/octet-stream``. La
    extensión la ponemos nosotros en el frontend a partir del mime real del
    blob, así que es más fiable que lo que llegue en la cabecera.
    """
    raw = str(filename or "").strip().lower()
    suffix = raw.rsplit(".", 1)[-1] if "." in raw else ""
    return suffix if suffix in AUDIO_MIME_BY_SUFFIX else ""


def audio_mime(suffix: str) -> str:
    return AUDIO_MIME_BY_SUFFIX.get(suffix, "application/octet-stream")


def normalize_target_seconds(value: Any, practice: PracticeSpec) -> int:
    """
    Duración prevista, en segundos.

    ``0`` significa "sin objetivo" y es legítimo (ensayo libre): la crítica
    entonces no compara tiempos en vez de inventarse un objetivo.
    """
    try:
        seconds = int(float(value))
    except (TypeError, ValueError):
        return practice.target_seconds
    if seconds <= 0:
        return 0
    return min(seconds, MAX_AUDIO_SECONDS)


def guard_audio(data: bytes, suffix: str, declared_seconds: Optional[float]) -> None:
    """
    Rechaza lo que no merece la pena mandar al proveedor. Lanza ``HTTPException``.

    Hay dos guardias y hacen cosas distintas:

    - El tope de BYTES es el que manda, y es el que de verdad protege: es un
      hecho comprobable del fichero que ya tenemos en memoria.
    - El de DURACIÓN es una comprobación de cortesía sobre lo que declara el
      cliente. No se puede medir la duración real de un WebM sin decodificarlo,
      y meter ffmpeg en el contenedor por esto sería pagar un mundo de
      dependencias para adelantar un error que el tope de bytes ya frena. Se
      confía en el número que manda la grabadora y se deja claro que es eso:
      un aviso temprano, no una barrera.
    """
    size = len(data)
    if size < MIN_AUDIO_BYTES:
        raise HTTPException(
            400, "No se ha grabado nada. Mantén pulsado y habla un momento."
        )
    if size > MAX_AUDIO_BYTES:
        megas = MAX_AUDIO_BYTES // (1024 * 1024)
        raise HTTPException(
            413,
            f"La grabación pasa de {megas} MB. Divide el ensayo en partes más cortas.",
        )
    if not suffix:
        raise HTTPException(
            400,
            "Ese formato de audio no se admite. Graba desde la app o sube un "
            "mp3, m4a, wav, ogg o webm.",
        )

    if declared_seconds is not None and declared_seconds > MAX_AUDIO_SECONDS:
        minutos = MAX_AUDIO_SECONDS // 60
        raise HTTPException(
            413,
            f"La grabación pasa de {minutos} minutos. Divide el ensayo en partes.",
        )


# ─── URLs por proveedor ──────────────────────────────────────────


def transcriptions_url(spec: ProviderSpec) -> str:
    """
    Endpoint de transcripción.

    Se deriva de ``base_url`` igual que en las imágenes para no repetir
    dominios, aunque hoy solo OpenAI llegue hasta aquí: el día que otro
    proveedor implemente el contrato, esto ya funciona.
    """
    if spec.base_url:
        return f"{spec.base_url.rstrip('/')}/audio/transcriptions"
    return _OPENAI_TRANSCRIPTIONS_URL


def speech_url(spec: ProviderSpec) -> str:
    if spec.base_url:
        return f"{spec.base_url.rstrip('/')}/audio/speech"
    return _OPENAI_SPEECH_URL


def auth_headers(spec: ProviderSpec, api_key: str) -> Dict[str, str]:
    """Cabecera de autenticación. Misma forma que en ``image_service``."""
    clean = api_key.strip()
    if spec.key_header.lower() == "authorization":
        return {"Authorization": f"Bearer {clean}"}
    return {spec.key_header: clean}


# ─── Errores saneados ────────────────────────────────────────────


def _raise_provider_error(spec: ProviderSpec, response: httpx.Response) -> None:
    """
    Traduce el error del proveedor SIN reenviar su cuerpo.

    Mismo criterio que en ``image_service``: algunos 401 hacen eco del prefijo
    de la key que se les mandó, así que el cuerpo del proveedor no sale nunca
    de aquí. Solo se mira el código de estado.
    """
    status = response.status_code
    if status in (401, 403):
        raise HTTPException(401, f"La API key no es válida para {spec.label}.")
    if status == 429:
        raise HTTPException(
            429, "El proveedor está limitando las peticiones. Prueba en un minuto."
        )
    if status == 413:
        raise HTTPException(
            413, "El proveedor ha rechazado la grabación por tamaño. Prueba con menos."
        )
    if status == 400:
        raise HTTPException(
            400,
            f"{spec.label} no ha podido leer la grabación. Prueba a grabarla de nuevo.",
        )
    raise HTTPException(502, f"{spec.label} no ha podido procesar el audio.")


# ─── Transcripción ───────────────────────────────────────────────


@dataclass(frozen=True)
class Transcription:
    """Lo que se sacó del audio."""

    text: str
    model: str
    #: Duración en segundos. ``0.0`` si no se pudo saber.
    duration_seconds: float
    #: "audio" si la midió el proveedor sobre el fichero, "grabadora" si es lo
    #: que declaró el cliente. Viaja hasta la interfaz porque no es lo mismo:
    #: la del proveedor es un hecho y la de la grabadora es un cronómetro que
    #: puede haber seguido corriendo con el micro en silencio.
    duration_source: str
    language: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "model": self.model,
            "duration_seconds": round(self.duration_seconds, 2),
            "duration_source": self.duration_source,
            "language": self.language,
        }


def parse_transcription(
    payload: Any, model: str, fallback_seconds: float
) -> Transcription:
    """
    Convierte la respuesta del proveedor en ``Transcription``.

    Se acepta tanto la forma corta (``{"text": …}``, que es lo que devuelven
    gpt-4o-transcribe y compañía) como la larga de ``verbose_json``
    (``{"text", "duration", "language", "segments"}``) porque el modelo elegido
    decide cuál llega. Si no viene duración se usa la de la grabadora, y se
    marca como tal en ``duration_source``.
    """
    if not isinstance(payload, dict):
        raise HTTPException(502, "El proveedor ha devuelto una respuesta ilegible.")

    text = str(payload.get("text") or "").strip()

    raw_duration = payload.get("duration")
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        duration = 0.0

    if duration > 0:
        source = "audio"
    else:
        duration = max(0.0, float(fallback_seconds or 0.0))
        source = "grabadora" if duration > 0 else "desconocida"

    return Transcription(
        text=text,
        model=model,
        duration_seconds=duration,
        duration_source=source,
        language=str(payload.get("language") or ""),
    )


async def transcribe(
    spec: ProviderSpec,
    api_key: str,
    audio: bytes,
    filename: str,
    model: Optional[str] = None,
    language: str = "es",
    declared_seconds: Optional[float] = None,
) -> Transcription:
    """
    Transcribe una grabación. Sube el audio en multipart, como pide la API.

    ``language`` se manda SIEMPRE aunque sea opcional: sin él, whisper detecta
    el idioma por su cuenta y una frase corta en español con un nombre propio
    en hebreo se le va al portugués o al italiano de vez en cuando. Con el
    idioma fijado eso desaparece.
    """
    if not (api_key or "").strip():
        raise HTTPException(
            428, "Configura tu API key en Más → Ajustes de IA para usar la voz."
        )
    if not spec.supports_stt:
        raise HTTPException(400, f"{spec.label} no transcribe audio.")

    # Sin nombre de fichero se asume webm, que es lo que graba la app. Con un
    # nombre de extensión desconocida NO se asume nada: se deja vacío y
    # ``guard_audio`` lo rechaza, porque adivinar el formato de algo que el
    # usuario ha subido a mano acaba en un 400 del proveedor más caro y más
    # difícil de entender.
    suffix = normalize_suffix(filename)
    if not suffix and not str(filename or "").strip():
        suffix = DEFAULT_AUDIO_SUFFIX

    guard_audio(audio, suffix, declared_seconds)

    chosen = normalize_stt_model(spec, model)

    # verbose_json solo donde está verificado que lo acepta: pedirlo a
    # gpt-4o-mini-transcribe devuelve 400 y tiraría el ensayo entero por querer
    # un dato accesorio.
    data: Dict[str, str] = {"model": chosen}
    if language:
        data["language"] = language
    if chosen in spec.stt_duration_models:
        data["response_format"] = "verbose_json"

    files = {"file": (f"ensayo.{suffix}", audio, audio_mime(suffix))}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                transcriptions_url(spec),
                headers=auth_headers(spec, api_key),
                files=files,
                data=data,
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Fallo transcribiendo con %s: %s", spec.id, redact(exc))
        raise HTTPException(
            504, "El proveedor ha tardado demasiado. Prueba con una grabación más corta."
        )

    if response.status_code >= 400:
        _raise_provider_error(spec, response)

    try:
        payload = response.json()
    except Exception:
        raise HTTPException(502, f"{spec.label} ha devuelto una respuesta ilegible.")

    result = parse_transcription(payload, chosen, declared_seconds or 0.0)
    if not result.text:
        raise HTTPException(
            422,
            "No se ha entendido nada en la grabación. Comprueba el micrófono y "
            "habla algo más cerca.",
        )
    return result


# ─── Síntesis de voz ─────────────────────────────────────────────


def clip_for_speech(text: str) -> str:
    """
    Recorta el texto a sintetizar por una frontera de frase.

    El corte a pelo en el carácter 3800 deja la voz cortada a mitad de palabra,
    que suena a fallo. Se retrocede hasta el último punto para que termine
    donde termina una idea.
    """
    clean = " ".join((text or "").split()).strip()
    if len(clean) <= MAX_TTS_CHARS:
        return clean

    recortado = clean[:MAX_TTS_CHARS]
    corte = max(recortado.rfind(". "), recortado.rfind("? "), recortado.rfind("! "))
    if corte > MAX_TTS_CHARS // 2:
        return recortado[: corte + 1]
    return recortado.rstrip()


#: Cómo se pide que suene la voz. Solo lo aceptan los modelos nuevos, pero se
#: comprobó que tts-1 lo ignora en vez de dar 400, así que se manda siempre y
#: no hace falta un `if` por modelo.
SPEECH_INSTRUCTIONS = (
    "Habla en español de España, con calma y en tono de conversación, como "
    "quien comenta algo con un amigo. Sin entonación de locutor ni de anuncio."
)


async def synthesize(
    spec: ProviderSpec,
    api_key: str,
    text: str,
    model: Optional[str] = None,
    voice: Optional[str] = None,
) -> Tuple[str, str, bytes]:
    """
    Convierte texto en audio. Devuelve ``(modelo, voz, bytes)``.

    Los bytes NO tocan el disco del backend, por lo mismo que las imágenes: el
    contenedor de Railway tiene filesystem efímero y la app no tiene
    autenticación, así que un almacén de audio en el servidor sería a la vez
    temporal y compartido entre visitantes.
    """
    if not (api_key or "").strip():
        raise HTTPException(
            428, "Configura tu API key en Más → Ajustes de IA para oír la respuesta."
        )
    if not spec.supports_tts:
        raise HTTPException(400, f"{spec.label} no genera voz.")

    clean = clip_for_speech(text)
    if not clean:
        raise HTTPException(400, "No hay texto que leer.")

    chosen = normalize_tts_model(spec, model)
    chosen_voice = normalize_voice(spec, voice)

    body = {
        "model": chosen,
        "voice": chosen_voice,
        "input": clean,
        "instructions": SPEECH_INSTRUCTIONS,
        "response_format": TTS_FORMAT,
    }

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                speech_url(spec), headers=auth_headers(spec, api_key), json=body
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Fallo sintetizando con %s: %s", spec.id, redact(exc))
        raise HTTPException(504, "El proveedor ha tardado demasiado en generar la voz.")

    if response.status_code >= 400:
        _raise_provider_error(spec, response)

    audio = response.content
    if not audio:
        raise HTTPException(502, f"{spec.label} no ha devuelto ningún audio.")

    return chosen, chosen_voice, audio


# ─── La crítica ──────────────────────────────────────────────────


_PRACTICE_FRAME = """\
## QUÉ ESTÁS HACIENDO AHORA

No estás redactando: estás escuchando. El usuario acaba de ensayar en voz alta
y lo que tienes delante es la transcripción automática de esa grabación.

Aquí NO tienes herramientas de búsqueda, y no te hacen falta: no vienes a
comprobar citas contra las publicaciones, vienes a decirle cómo ha sonado. Si
te falta un dato para opinar, dilo en media línea y sigue.

Sobre la transcripción: es automática. Un nombre propio mal escrito, una
palabra suelta rara o una frase cortada es casi siempre culpa del
reconocimiento, no del orador. No se lo apuntes como fallo de dicción salvo que
se repita tanto que solo pueda venir de cómo habla.

Tampoco tienes el audio: no puedes juzgar el volumen, el timbre ni los
silencios. No opines de lo que no has oído. De lo que sí sabes con certeza es
del tiempo y de lo que dijo.\
"""


_FEEDBACK_FORMAT = """\
## CÓMO DEVUELVES LA CRÍTICA

Le hablas a la persona, no rellenas una ficha de evaluación. Sin encabezados de
sección, sin puntuaciones y sin tabla.

1. Empieza por lo que ha funcionado, en una o dos frases, y CONCRETO: cita lo
   que dijo. "Bien" a secas no le sirve de nada y suena a relleno.
2. El tiempo: cuánto ha durado de verdad frente a lo que buscaba, y qué haría
   falta quitar o añadir. Si no hay duración objetivo, no te la inventes.
3. De dos a cuatro cosas que cambiaría, ordenadas por la que más mejora el
   resultado. Cada una con la frase concreta a la que te refieres y con la
   alternativa dicha en voz alta, no descrita. Si algo hay que decirlo de otra
   manera, escribe cómo lo dirías tú.
4. Cierra con UNA cosa en la que fijarse en el próximo intento. Una sola.

Recuerda de dónde vienes: primero la persona. Esto es un ensayo, no un examen,
y quien lo ha grabado está intentando hacerlo mejor. Se le dice la verdad, y se
le dice de forma que le den ganas de repetirlo.\
"""


def format_duration(seconds: float) -> str:
    """
    "4 min 12 s". El modelo razona peor con 252.0 que con la forma hablada, y
    esto se cuela literal en el prompt.
    """
    total = int(round(max(0.0, seconds)))
    if total < 60:
        return f"{total} s"
    minutos, resto = divmod(total, 60)
    return f"{minutos} min {resto} s" if resto else f"{minutos} min"


def build_feedback_prompt(practice: PracticeSpec) -> str:
    """
    System prompt de la crítica.

    Lleva IDENTITY y VOICE_GUIDE del ``style_guide`` —español de España, sin
    lenguaje de coach, sin emojis, primero la persona— y NO lleva
    RESEARCH_POLICY: esa política ordena llamar a una herramienta antes de
    responder, y en esta pantalla no hay ninguna. Dejarla puesta hacía que el
    modelo pidiera permiso para buscar en vez de dar la crítica.
    """
    return "\n\n".join(
        [IDENTITY, VOICE_GUIDE, _PRACTICE_FRAME, practice.prompt, _FEEDBACK_FORMAT]
    )


def build_feedback_input(
    practice: PracticeSpec,
    transcript: str,
    duration_seconds: float,
    duration_source: str,
    target_seconds: int,
    notes: str = "",
) -> str:
    """
    El turno de usuario: los datos del ensayo y la transcripción.

    La transcripción va al FINAL y entre marcas: es lo más largo del mensaje y
    lo que más se parece a instrucciones (es un discurso, con imperativos
    dentro). Sin delimitar, un "y ahora resume esto en tres puntos" dicho
    dentro del ensayo se lee como una orden.
    """
    lineas = [f"Tipo de ensayo: {practice.label}."]

    if duration_seconds > 0:
        medida = (
            "medida sobre el audio"
            if duration_source == "audio"
            else "según el cronómetro de la grabadora, puede incluir silencio al final"
        )
        lineas.append(f"Duración real: {format_duration(duration_seconds)} ({medida}).")
    else:
        lineas.append("Duración real: no se ha podido medir.")

    if target_seconds > 0:
        lineas.append(f"Duración objetivo: {format_duration(target_seconds)}.")
    else:
        lineas.append("Sin duración objetivo: no compares tiempos.")

    palabras = len(transcript.split())
    lineas.append(f"Palabras transcritas: {palabras}.")

    if duration_seconds >= 10 and palabras:
        ritmo = palabras / (duration_seconds / 60.0)
        lineas.append(f"Ritmo: {ritmo:.0f} palabras por minuto.")

    if notes.strip():
        lineas.append(f"Lo que pide el usuario que mires: {notes.strip()}")

    lineas.append("")
    lineas.append("--- TRANSCRIPCIÓN DEL ENSAYO ---")
    lineas.append(transcript)
    lineas.append("--- FIN DE LA TRANSCRIPCIÓN ---")

    return "\n".join(lineas)


async def critique(
    client: Any,
    model: str,
    practice: PracticeSpec,
    transcription: Transcription,
    target_seconds: int,
    notes: str = "",
    answer_params: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Pide la crítica al modelo de chat del mismo proveedor.

    Recibe el ``client`` ya construido (el ``AsyncOpenAI`` de ``ChatRuntime``)
    en vez de construirlo aquí: así el router decide de dónde sale la key y los
    tests pueden sustituirlo por un doble sin tocar la red ni monkeypatchear
    el SDK entero.

    Sin streaming a propósito. La transcripción ya se ha entregado y se está
    leyendo en pantalla; la crítica llega detrás en unos segundos, y montar SSE
    aquí sería complejidad por una espera que el usuario no percibe parado.
    """
    messages = [
        {"role": "system", "content": build_feedback_prompt(practice)},
        {
            "role": "user",
            "content": build_feedback_input(
                practice,
                transcription.text,
                transcription.duration_seconds,
                transcription.duration_source,
                target_seconds,
                notes,
            ),
        },
    ]

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_completion_tokens=FEEDBACK_MAX_TOKENS,
            **(answer_params or {}),
        )
    except Exception as exc:
        logger.warning("Fallo generando la crítica: %s", redact(exc))
        raise HTTPException(
            502,
            "Se ha transcrito el ensayo pero no se ha podido generar la crítica. "
            "Vuelve a intentarlo.",
        )

    try:
        content = response.choices[0].message.content or ""
    except (AttributeError, IndexError, TypeError):
        content = ""

    return content.strip()


__all__ = [
    "AUDIO_MIME_BY_SUFFIX",
    "DEFAULT_PRACTICE",
    "FEEDBACK_MAX_TOKENS",
    "MAX_AUDIO_BYTES",
    "MAX_AUDIO_SECONDS",
    "MAX_TTS_CHARS",
    "MIN_AUDIO_BYTES",
    "PRACTICE_MODES",
    "SPEECH_INSTRUCTIONS",
    "TTS_FORMAT",
    "TTS_MIME",
    "PracticeSpec",
    "Transcription",
    "audio_mime",
    "auth_headers",
    "build_feedback_input",
    "build_feedback_prompt",
    "clip_for_speech",
    "critique",
    "format_duration",
    "get_practice",
    "guard_audio",
    "list_practices",
    "normalize_stt_model",
    "normalize_suffix",
    "normalize_target_seconds",
    "normalize_tts_model",
    "normalize_voice",
    "parse_transcription",
    "speech_url",
    "synthesize",
    "transcribe",
    "transcriptions_url",
]
