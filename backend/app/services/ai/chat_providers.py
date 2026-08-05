"""
Chat providers — capa de proveedor del chat (OpenAI y Google Gemini).

NO confundir con ``services/ai/providers/``, que sirve al viejo ``ai_service``
y al AIPanel con otro contrato (bloques de análisis, no conversación).

Decisión de fondo (ADR-1 del plan): el chat multironda sigue usando el SDK
``openai`` ya instalado, apuntando su ``base_url`` a la capa de compatibilidad
de Google. Todo lo que el bucle de ``chat_service`` necesita (streaming,
function calling, ``stream_options``) está soportado ahí, así que **el bucle no
cambia de forma, solo de cliente**. Cero dependencias nuevas.

Decisión de fondo (ADR-3): la API key del usuario NUNCA se persiste ni se
cachea aquí. ``build_runtime`` construye un ``AsyncOpenAI`` por petición: es
barato y elimina de raíz el cruce de identidades entre visitantes que tendría
un diccionario global de clientes indexado por key.

Todo lo que decide comportamiento (``get_provider``, ``normalize_effort``,
``effort_params``, ``tool_choice_for``) son funciones puras: se testean sin
red y sin keys.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


# ─── Esfuerzo unificado ──────────────────────────────────────────
#
# La app habla su propio vocabulario de esfuerzo (en español, estable) y cada
# proveedor lo traduce. Así el cliente no tiene que saber que OpenAI dice
# "xhigh" y que Google no admite "none".
#
#   id STUDY   UI                    OpenAI     Google (compat)
#   ninguno    Sin razonar (rápido)  none       minimal
#   bajo       Bajo                  low        low
#   medio      Medio                 medium     medium
#   alto       Alto                  high       high
#   maximo     Máximo                xhigh      high      ← degrada
EFFORT_IDS: Tuple[str, ...] = ("ninguno", "bajo", "medio", "alto", "maximo")

EFFORT_LABELS: Dict[str, str] = {
    "ninguno": "Sin razonar (rápido)",
    "bajo": "Bajo",
    "medio": "Medio",
    "alto": "Alto",
    "maximo": "Máximo",
}

#: A dónde degrada un esfuerzo que no se entiende. El más barato y rápido: un
#: id mal escrito no puede convertirse en una factura sorpresa.
DEFAULT_EFFORT = "ninguno"

#: Se aceptan también los nombres nativos de cada proveedor: el entorno del
#: servidor lleva años configurado con ``OPENAI_REASONING_EFFORT=high``.
#: Deliberadamente SIN "max": ese valor es el que tuvo el chat caído en
#: producción (la API lo rechaza con 400) y tiene que seguir degradando.
_EFFORT_ALIASES: Dict[str, str] = {
    "ninguno": "ninguno",
    "none": "ninguno",
    "minimal": "ninguno",
    "bajo": "bajo",
    "low": "bajo",
    "medio": "medio",
    "medium": "medio",
    "alto": "alto",
    "high": "alto",
    "maximo": "maximo",
    "máximo": "maximo",
    "xhigh": "maximo",
}


@dataclass(frozen=True)
class ProviderSpec:
    """Todo lo que distingue a un proveedor, en datos y no en ``if``."""

    id: str
    label: str
    #: ``None`` = el default del SDK (api.openai.com). NUNCA se acepta desde el
    #: cliente: sería un SSRF de manual.
    base_url: Optional[str]
    #: Endpoint NATIVO de listado de modelos (el de la capa de compatibilidad
    #: de Google no garantiza los metadatos).
    models_url: str
    #: Cómo viaja la key en ese endpoint nativo.
    key_header: str
    #: Placeholder del input de la interfaz ("sk-…").
    key_hint: str
    #: Dónde consigue el usuario su key.
    key_url: str
    default_model: str
    efforts: Tuple[str, ...]
    #: id STUDY → valor nativo de ``reasoning_effort``.
    effort_map: Dict[str, str]
    #: Valor de ``reasoning_effort`` obligatorio en las rondas CON ``tools``.
    #: ``None`` = no mandar el parámetro en esas rondas.
    tool_round_effort: Optional[str]
    #: ⚠️ No verificado en Gemini: capacidad, no suposición (ver plan §0).
    supports_tool_choice_required: bool
    supports_images: bool
    image_models: Tuple[str, ...]
    deep_research_models: Tuple[str, ...]
    #: Lista estática de respaldo: el desplegable de modelos NUNCA se queda
    #: vacío aunque el listado remoto falle.
    fallback_models: Tuple[str, ...]
    #: Variables de entorno de las que sale la key en modo servidor.
    key_env_vars: Tuple[str, ...] = field(default=())
    #: El proveedor mete su razonamiento dentro de ``content``, entre
    #: ``<think>`` y ``</think>``, en vez de en un campo aparte. Si no se
    #: limpia, el usuario ve el monólogo interno del modelo dentro de su
    #: comentario de 30 segundos. Verificado en MiniMax, que lo hace SIEMPRE.
    inline_reasoning: bool = False

    # ─── Voz ─────────────────────────────────────────────────────
    #
    # Misma regla que ``image_models`` y por el mismo motivo: aquí solo entra
    # lo que se ha llamado contra la API de verdad. Una tupla vacía significa
    # "no verificado", y la interfaz no ofrece lo que esté vacío. Prometer un
    # proveedor de voz que responde 404 es peor que no ofrecerlo.

    #: Modelos de transcripción (voz → texto).
    stt_models: Tuple[str, ...] = ()
    #: Subconjunto de ``stt_models`` que devuelve además la DURACIÓN real del
    #: audio, o sea los que aceptan ``response_format=verbose_json``. Va por
    #: modelo y no por proveedor porque dentro de OpenAI unos lo aceptan y
    #: otros contestan 400: es capacidad del modelo, no de la cuenta.
    stt_duration_models: Tuple[str, ...] = ()
    #: Modelos de síntesis (texto → voz). Vacío = la práctica es solo escrita.
    tts_models: Tuple[str, ...] = ()
    #: Voces admitidas. Se comprobaron una a una, no se copiaron de la doc.
    tts_voices: Tuple[str, ...] = ()

    @property
    def supports_deep_research(self) -> bool:
        return bool(self.deep_research_models)

    @property
    def supports_stt(self) -> bool:
        """¿Se puede dictar con este proveedor?"""
        return bool(self.stt_models)

    @property
    def supports_tts(self) -> bool:
        """¿Puede contestar hablando?"""
        return bool(self.tts_models and self.tts_voices)


OPENAI = ProviderSpec(
    id="openai",
    label="OpenAI",
    base_url=None,
    models_url="https://api.openai.com/v1/models",
    key_header="Authorization",
    key_hint="sk-…",
    key_url="https://platform.openai.com/api-keys",
    default_model="gpt-5.6-luna",
    efforts=EFFORT_IDS,
    effort_map={
        "ninguno": "none",
        "bajo": "low",
        "medio": "medium",
        "alto": "high",
        "maximo": "xhigh",
    },
    # "Function tools with reasoning_effort are not supported for gpt-5.6-* in
    # /v1/chat/completions ... set reasoning_effort to 'none'". Es lo que ya
    # hacía chat_service; aquí solo se generaliza.
    tool_round_effort="none",
    supports_tool_choice_required=True,
    supports_images=True,
    # gpt-image-1 se deprecia el 23/10/2026: no se ofrece.
    image_models=("gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2"),
    deep_research_models=("o4-mini-deep-research", "o3-deep-research"),
    fallback_models=(
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
        "gpt-4.1-mini",
        "gpt-4o-mini",
    ),
    key_env_vars=("OPENAI_API_KEY",),
    # Verificado en vivo (2026-08-02) contra la cuenta del .env:
    #   POST /v1/audio/transcriptions → 200 {"text": …} con los tres modelos,
    #   incluido un contenedor WebM/Opus real como el que produce MediaRecorder.
    # whisper-1 va PRIMERO y es el que se usa por defecto: es el único de los
    # tres que acepta response_format=verbose_json y devuelve la duración real
    # del audio, que es justo lo que la crítica del ensayo necesita para decir
    # "te has ido dos minutos". Los otros dos contestan 400 a verbose_json.
    stt_models=("whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"),
    stt_duration_models=("whisper-1",),
    # POST /v1/audio/speech → 200 audio/mpeg con los tres.
    tts_models=("gpt-4o-mini-tts", "tts-1", "tts-1-hd"),
    # Las trece devolvieron 200 una por una. gpt-audio-mini NO: ese modelo
    # existe en /v1/models pero /v1/audio/speech lo rechaza con "Invalid URL",
    # así que no está en la lista.
    tts_voices=(
        "alloy",
        "ash",
        "ballad",
        "coral",
        "echo",
        "fable",
        "onyx",
        "nova",
        "sage",
        "shimmer",
        "verse",
        "cedar",
        "marin",
    ),
)


GOOGLE = ProviderSpec(
    id="google",
    label="Google Gemini",
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    models_url="https://generativelanguage.googleapis.com/v1beta/models",
    key_header="x-goog-api-key",
    key_hint="AIza…",
    key_url="https://aistudio.google.com/apikey",
    default_model="gemini-3.5-flash",
    efforts=EFFORT_IDS,
    # Mapeo oficial de la capa de compatibilidad. No existe "none": Gemini 3
    # no apaga el pensamiento del todo, así que "ninguno" se aplica como
    # "minimal" y se informa por metadata.
    effort_map={
        "ninguno": "minimal",
        "bajo": "low",
        "medio": "medium",
        "alto": "high",
        "maximo": "high",
    },
    # NO se manda `reasoning_effort` en las rondas con tools. Antes iba
    # "minimal", que es el vocabulario NATIVO de Gemini y no está en el enum
    # de su capa de compatibilidad (none/low/medium/high). El parámetro solo
    # existe aquí por una restricción de OpenAI —que exige 'none' cuando hay
    # function tools— y esa restricción no aplica a Google, así que mandarlo
    # era asumir un riesgo a cambio de nada. Ante la duda, no se manda: el
    # esfuerzo elegido por el usuario sigue aplicándose en la ronda final,
    # que es donde se redacta.
    tool_round_effort=None,
    # ⚠️ La doc de Google solo ejemplifica tool_choice "auto". Se degrada a
    # "auto" y research_policy.research_gap() ya fuerza la ronda extra si el
    # modelo no consultó nada.
    supports_tool_choice_required=False,
    supports_images=True,
    image_models=("gemini-2.5-flash-image", "gemini-3-pro-image-preview"),
    # Google no documenta restricción por dominio en su deep research: la
    # búsqueda saldría de wol.jw.org. Descalificante para esta app.
    deep_research_models=(),
    fallback_models=(
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    ),
    key_env_vars=("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    # Voz NO disponible por esta vía, y no es una suposición. Comprobado
    # (2026-08-02) contra la capa de compatibilidad:
    #   POST …/v1beta/openai/audio/transcriptions → 404 con cuerpo vacío
    #   POST …/v1beta/openai/audio/speech         → 404 con cuerpo vacío
    # Control con la MISMA petición sin key válida contra una ruta que sí
    # existe: …/v1beta/openai/chat/completions → 400 "Please pass a valid API
    # key". O sea que el 404 es la ruta, no la autenticación: la capa
    # compatible de Google no implementa /audio/*.
    #
    # Gemini sí tiene audio por su API nativa (entrada multimodal, y TTS en
    # generateContent), pero eso es OTRO contrato: ni multipart ni el cuerpo de
    # OpenAI. Mientras no se implemente y se pruebe, aquí va vacío.
    stt_models=(),
    tts_models=(),
    tts_voices=(),
)


MINIMAX = ProviderSpec(
    id="minimax",
    label="MiniMax",
    # Verificado en vivo: api.minimax.io/v1 responde al contrato de OpenAI
    # (models, chat/completions, tools, tool_choice). api.minimax.chat, que es
    # el dominio antiguo, devuelve 401 con una key válida del nuevo.
    base_url="https://api.minimax.io/v1/",
    models_url="https://api.minimax.io/v1/models",
    key_header="Authorization",
    key_hint="sk-…",
    key_url="https://platform.minimax.io/user-center/basic-information/interface-key",
    default_model="MiniMax-M2.7",
    efforts=EFFORT_IDS,
    # Acepta el parámetro sin error, pero su razonamiento no se apaga: sale
    # igualmente dentro de <think>. Se mapea de forma conservadora.
    effort_map={
        "ninguno": "low",
        "bajo": "low",
        "medio": "medium",
        "alto": "high",
        "maximo": "high",
    },
    tool_round_effort="low",
    #: Verificado: devuelve tool_calls tanto con "required" como con "auto".
    supports_tool_choice_required=True,
    # Generación de imagen no verificada por esta vía: no se ofrece hasta
    # comprobarla. Prometer un modelo de imagen que da 400 es peor que no
    # ofrecerlo.
    supports_images=False,
    image_models=(),
    deep_research_models=(),
    fallback_models=(
        "MiniMax-M3",
        "MiniMax-M2.7",
        "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5",
        "MiniMax-M2.5-highspeed",
        "MiniMax-M2.1",
        "MiniMax-M2",
    ),
    key_env_vars=("MINIMAX_API_KEY",),
    inline_reasoning=True,
    # Voz NO disponible por la vía compatible con OpenAI. Comprobado
    # (2026-08-02):
    #   POST /v1/audio/transcriptions → 404 "404 page not found"
    #   POST /v1/audio/speech         → 404 "404 page not found"
    # Control: /v1/chat/completions con la misma key falsa → 401
    # authorized_error. El 404 es la ruta.
    #
    # MiniMax sí tiene voz nativa: POST /v1/t2a_v2 respondió 200 con
    # base_resp.status_code 1004 ("login fail"), o sea que la ruta EXISTE y
    # solo faltaba la key. Pero es un contrato propio (no el de OpenAI) y en
    # este entorno no hay MINIMAX_API_KEY con la que comprobar la forma de la
    # respuesta ni el formato del audio. Sin poder probarlo, se queda fuera.
    stt_models=(),
    tts_models=(),
    tts_voices=(),
)


PROVIDERS: Dict[str, ProviderSpec] = {
    OPENAI.id: OPENAI,
    GOOGLE.id: GOOGLE,
    MINIMAX.id: MINIMAX,
}

DEFAULT_PROVIDER = "openai"

#: Valores de ejemplo que se quedan pegados en los .env y NO son keys.
_PLACEHOLDER_KEYS = frozenset(
    {"sk-your-api-key-here", "your-api-key-here", "changeme", "tu-api-key"}
)


# ─── Funciones puras ─────────────────────────────────────────────


def get_provider(provider_id: Optional[str]) -> ProviderSpec:
    """
    Devuelve el ``ProviderSpec`` de ``provider_id``.

    Tolerante igual que ``get_mode``: ``None``, cadena vacía o id desconocido
    degradan al proveedor por defecto. Un 422 por esto rompería el chat de un
    cliente antiguo sin ganar nada.
    """
    if not provider_id:
        return PROVIDERS[DEFAULT_PROVIDER]
    return PROVIDERS.get(str(provider_id).strip().lower(), PROVIDERS[DEFAULT_PROVIDER])


def normalize_effort(spec: ProviderSpec, effort: Optional[str]) -> str:
    """
    Id STUDY de esfuerzo válido para ``spec``.

    Devuelve ``""`` (cadena vacía) cuando NO hay que mandar el parámetro en
    absoluto: es lo que necesitan los modelos clásicos (gpt-4o-mini), que
    rechazan ``reasoning_effort``. Cualquier basura degrada a
    ``DEFAULT_EFFORT`` en vez de propagar un 400.
    """
    raw = str(effort or "").strip().lower()
    if not raw:
        return ""

    study = _EFFORT_ALIASES.get(raw)
    if study is None or study not in spec.efforts:
        logger.warning(
            "Esfuerzo %r no reconocido para %s. Usando %r.",
            raw,
            spec.id,
            DEFAULT_EFFORT,
        )
        return DEFAULT_EFFORT
    return study


def native_effort(spec: ProviderSpec, effort: Optional[str]) -> str:
    """Valor nativo de ``reasoning_effort`` que se le manda al proveedor."""
    study = normalize_effort(spec, effort)
    if not study:
        return ""
    return spec.effort_map.get(study, spec.effort_map[DEFAULT_EFFORT])


def effort_params(
    spec: ProviderSpec, effort: Optional[str]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    ``(params_de_las_rondas_con_tools, params_de_la_ronda_de_respuesta)``.

    Las rondas con ``tools`` van con el esfuerzo que el proveedor imponga
    (``none`` en OpenAI, ``minimal`` en Google); el esfuerzo elegido por el
    usuario se reserva para la ronda final, que va SIN tools y sí puede razonar.
    """
    applied = native_effort(spec, effort)
    if not applied:
        return {}, {}

    tool_params: Dict[str, Any] = (
        {"reasoning_effort": spec.tool_round_effort} if spec.tool_round_effort else {}
    )
    return tool_params, {"reasoning_effort": applied}


def tool_choice_for(spec: ProviderSpec, force: bool) -> str:
    """
    ``tool_choice`` de una ronda de investigación.

    ``"required"`` solo si el proveedor lo admite. Donde no (Gemini vía la capa
    de compatibilidad, sin confirmar en la doc) se degrada a ``"auto"``: peor
    garantía, pero nunca un 400 que tumbe el turno.
    """
    if force and spec.supports_tool_choice_required:
        return "required"
    return "auto"


#: Etiquetas del razonamiento en línea. Se comparan en minúsculas.
_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"


class ReasoningStripper:
    """
    Quita del stream los bloques ``<think>…</think>``.

    MiniMax mete su monólogo interno dentro de ``content`` en vez de en un
    campo aparte, así que sin esto el usuario ve el razonamiento del modelo
    pegado delante de su comentario. Los otros proveedores no lo hacen y el
    limpiador se queda inerte (``enabled=False`` devuelve el texto tal cual).

    Es un autómata y no un ``re.sub`` porque el texto llega TROCEADO: la
    etiqueta puede partirse entre dos chunks ("<thi" + "nk>"). Por eso se
    retienen los últimos caracteres cuando podrían ser el principio de una
    etiqueta, y por eso hay ``flush``.
    """

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled
        self._inside = False
        self._buffer = ""

    def feed(self, chunk: str) -> str:
        """Texto listo para emitir. Puede ser cadena vacía."""
        if not self.enabled:
            return chunk
        if not chunk:
            return ""

        self._buffer += chunk
        salida: list[str] = []

        while self._buffer:
            if self._inside:
                cierre = self._buffer.find(_THINK_CLOSE)
                if cierre == -1:
                    # Puede haber un cierre a medias al final; se retiene todo.
                    self._buffer = self._retener(self._buffer, _THINK_CLOSE)
                    break
                self._buffer = self._buffer[cierre + len(_THINK_CLOSE) :]
                self._inside = False
                continue

            apertura = self._buffer.find(_THINK_OPEN)
            if apertura == -1:
                retenido = self._retener(self._buffer, _THINK_OPEN)
                salida.append(self._buffer[: len(self._buffer) - len(retenido)])
                self._buffer = retenido
                break

            salida.append(self._buffer[:apertura])
            self._buffer = self._buffer[apertura + len(_THINK_OPEN) :]
            self._inside = True

        return "".join(salida)

    @staticmethod
    def _retener(texto: str, etiqueta: str) -> str:
        """
        La cola de ``texto`` que podría ser el principio de ``etiqueta``.

        Sin esto, un chunk que acabe en "<thi" se emitiría tal cual y el
        siguiente empezaría por "nk>": el bloque no se detectaría nunca.
        """
        for largo in range(min(len(etiqueta) - 1, len(texto)), 0, -1):
            if texto[-largo:] == etiqueta[:largo]:
                return texto[-largo:]
        return ""

    def flush(self) -> str:
        """
        Lo que quedó retenido al cerrar el stream.

        Si el modelo abrió un ``<think>`` y no lo cerró, lo retenido es
        razonamiento y se tira. Si no, era texto de verdad que se estaba
        guardando por si acaso y hay que emitirlo.
        """
        resto = "" if self._inside else self._buffer
        self._buffer = ""
        self._inside = False
        return resto


def is_usable_key(api_key: Optional[str]) -> bool:
    """¿Es esto una key de verdad y no el placeholder del .env.example?"""
    clean = (api_key or "").strip()
    return bool(clean) and clean.lower() not in _PLACEHOLDER_KEYS


# ─── Runtime por petición ────────────────────────────────────────


@dataclass(frozen=True)
class ChatRuntime:
    """
    El proveedor ya resuelto para UNA petición.

    ``source`` es telemetría ("client" | "server") para saber si la petición
    fue con la key del usuario o con la del servidor. La key NO se guarda aquí:
    vive dentro del cliente del SDK y muere con él.
    """

    provider: ProviderSpec
    client: AsyncOpenAI
    model: str
    #: Id STUDY normalizado ("" = no mandar el parámetro).
    effort: str
    #: Valor nativo que se aplica de verdad ("" = ninguno). Puede diferir del
    #: pedido: "maximo" en Google se aplica como "high".
    effort_applied: str
    tool_params: Dict[str, Any]
    answer_params: Dict[str, Any]
    source: str

    def metadata(self) -> Dict[str, Any]:
        """Lo que se expone por SSE. Nunca la key."""
        return {
            "provider": self.provider.id,
            "model": self.model,
            "effort": self.effort,
            "effort_applied": self.effort_applied,
            "source": self.source,
        }


def build_runtime(
    provider_id: Optional[str],
    api_key: str,
    model: Optional[str] = None,
    effort: Optional[str] = None,
    source: str = "client",
    timeout: float = 180.0,
) -> ChatRuntime:
    """
    Construye el runtime de una petición.

    Un ``AsyncOpenAI`` nuevo por petición a propósito: cachearlos en un dict
    global indexado por key sería una fuga de memoria y, peor, un cruce de
    identidades entre visitantes de una app sin autenticación.
    """
    spec = get_provider(provider_id)
    tool_params, answer_params = effort_params(spec, effort)

    client = AsyncOpenAI(
        api_key=api_key,
        timeout=timeout,
        **({"base_url": spec.base_url} if spec.base_url else {}),
    )

    chosen = (model or "").strip() or spec.default_model

    return ChatRuntime(
        provider=spec,
        client=client,
        model=chosen,
        effort=normalize_effort(spec, effort),
        effort_applied=native_effort(spec, effort),
        tool_params=tool_params,
        answer_params=answer_params,
        source=source,
    )


def server_provider_id() -> str:
    """Proveedor del modo servidor (``CHAT_PROVIDER``, default openai)."""
    return get_provider(os.getenv("CHAT_PROVIDER", DEFAULT_PROVIDER)).id


def server_api_key(spec: Optional[ProviderSpec] = None) -> str:
    """Key del servidor para ``spec``, o cadena vacía si no hay ninguna."""
    target = spec or get_provider(server_provider_id())
    for name in target.key_env_vars:
        candidate = os.getenv(name, "").strip()
        if is_usable_key(candidate):
            return candidate
    return ""


def has_server_key() -> bool:
    """¿Puede el backend responder sin que el usuario traiga su key?"""
    return bool(server_api_key())


def server_runtime(
    model: Optional[str] = None, effort: Optional[str] = None
) -> Optional[ChatRuntime]:
    """
    Runtime del modo servidor a partir de las variables de entorno de siempre.

    ``None`` si no hay key configurada: quien llama decide si eso es un 503 o
    un mensaje pidiendo que el usuario ponga la suya.

    Las env se leen en cada llamada (y no en import time) para que un cambio de
    configuración no exija reiniciar, y para que los tests puedan monkeypatchear.
    """
    spec = get_provider(server_provider_id())
    key = server_api_key(spec)
    if not key:
        return None

    return build_runtime(
        spec.id,
        key,
        model=(model or os.getenv("OPENAI_MODEL", "").strip() or spec.default_model),
        effort=(
            effort
            if effort is not None
            else os.getenv("OPENAI_REASONING_EFFORT", "none")
        ),
        source="server",
    )


__all__ = [
    "ProviderSpec",
    "ChatRuntime",
    "ReasoningStripper",
    "PROVIDERS",
    "DEFAULT_PROVIDER",
    "DEFAULT_EFFORT",
    "EFFORT_IDS",
    "EFFORT_LABELS",
    "OPENAI",
    "GOOGLE",
    "MINIMAX",
    "get_provider",
    "normalize_effort",
    "native_effort",
    "effort_params",
    "tool_choice_for",
    "is_usable_key",
    "build_runtime",
    "server_runtime",
    "server_api_key",
    "server_provider_id",
    "has_server_key",
]
