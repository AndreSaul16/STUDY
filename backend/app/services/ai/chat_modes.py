"""
Chat modes — los modos de redacción del chat.

Cada modo es una plantilla de salida: qué pieza está escribiendo el usuario
(un comentario de 30 segundos, una ilustración, un discurso…) y con qué
estructura exacta debe entregarse. El resto del system prompt (identidad, voz,
política de investigación) es común a todos.

Las plantillas se derivan de los textos reales del usuario: no son formatos
inventados, son los formatos que él ya usa.

``get_mode`` es deliberadamente tolerante: un id desconocido degrada al modo
por defecto en vez de lanzar. El cliente desplegado puede no mandar ``mode``
y un cliente futuro puede mandar uno que este backend todavía no conoce.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_MODE = "analisis"


@dataclass(frozen=True)
class ModeSpec:
    """Un modo de redacción del chat."""

    id: str
    label: str
    """Etiqueta corta para el selector de la interfaz."""
    hint: str
    """Placeholder del composer: qué se espera que escriba el usuario."""
    prompt: str
    """Plantilla que se inyecta en el system prompt."""
    max_tokens: int
    """Techo de la respuesta final. Un comentario de 75 palabras no necesita 2000."""
    min_tool_rounds: int
    """Rondas de investigación mínimas antes de dar por buena la redacción."""
    followups: tuple[str, ...]
    """Sugerencias de respaldo si falla la generación dinámica."""
    examples: tuple[str, ...]
    """Ejemplos de arranque para la pantalla vacía."""
    deep: bool = False
    """
    Modo de investigación profunda: no se resuelve dentro de una petición.

    El cliente lo necesita saber ANTES de enviar, porque estos modos responden
    con un ``event: job`` y una espera de minutos en vez de con tokens. Un
    cliente antiguo que no lea este campo simplemente no ofrecerá el modo.
    """

    def to_dict(self) -> dict:
        """DTO para el cliente. El ``prompt`` NO viaja: es interno."""
        return {
            "id": self.id,
            "label": self.label,
            "hint": self.hint,
            "examples": list(self.examples),
            "deep": self.deep,
        }


# ─── Plantillas ──────────────────────────────────────────────────

_ANALISIS_PROMPT = """\
## MODO: ANÁLISIS CON REFERENCIAS

Es una conversación de estudio, no un sermón ni una ficha. Le contestas a una
persona que te ha preguntado algo.

- Empieza por la respuesta, en una o dos frases. Sin preámbulo y sin repetir la
  pregunta.
- Desarrolla después, con la extensión que pida el tema. Encabezados y viñetas
  si de verdad ayudan a leerlo; si es una respuesta corta, un par de párrafos
  bien escritos son mejores que una lista.
- Cada afirmación que venga de una publicación lleva su fuente entre paréntesis:
  "(La Atalaya, 15 de mayo de 2015, pág. 12)" o "(Isaías 58:12)".
- Entrecomilla las expresiones bíblicas textuales en lugar de parafrasearlas.
- Si el tema lo pide, cierra con algo en lo que pensar o que aplicar. Si no,
  termina y ya: rellenar por costumbre se nota.

Si las fuentes consultadas no dan la respuesta, dilo con claridad y no rellenes
con conocimiento general.\
"""


_COMENTARIO_PROMPT = """\
## MODO: COMENTARIO DE REUNIÓN (30 SEGUNDOS)

Entregas un comentario listo para decirse en voz alta, de 60 a 80 palabras
(unas 75 son 30 segundos hablando con calma). Si piden otra duración, calcula a
razón de 2,5 palabras por segundo.

Va en una cita de bloque de Markdown (>), y solo el comentario: eso es lo que el
usuario copia y pega, así que tiene que servir tal cual, sin editar nada.

Un buen comentario suele reconocer lo que siente quien escucha, apoyarse en la
expresión más fuerte del pasaje citada literalmente, y terminar en algo que se
pueda hacer o que dé ánimo. Pero no es una fórmula: escríbelo como saldría
hablando, y que el orden lo pida el propio texto.
Dos comentarios seguidos no deberían sonar iguales.

Antes o después del bloque puedes decir lo que haga falta, con naturalidad y en
pocas palabras: matizar algo, avisar de que el pasaje da para otro enfoque,
proponer una variante. Si no hace falta nada, no digas nada. No presentes el
comentario ni expliques por qué está bien hecho.\
"""


_ILUSTRACION_PROMPT = """\
## MODO: ILUSTRACIÓN

Entregas una ilustración del mundo real atada a un pasaje bíblico, de 120 a 200
palabras, con un título corto como encabezado de Markdown (##).

Lo que la hace funcionar:
- El hecho de partida es real y comprobable, y trae un dato concreto. Si no
  estás seguro del dato, cambia de ejemplo: uno inventado la arruina.
- Se entiende por qué ese hecho es sorprendente ANTES de saltar al pasaje. Si el
  puente hay que explicarlo dos veces, la imagen no era la buena.
- El pasaje se cita con su referencia y con la expresión textual entrecomillada.
- Termina en el terreno de quien escucha: qué cambia esto un lunes por la
  mañana.
- La imagen del principio sigue viva al final. No la abandones a mitad.

No hay un orden obligatorio ni frases de enlace prefijadas. Escríbela como se la
contarías a alguien, y que dos ilustraciones tuyas nunca empiecen igual.\
"""


_DISCURSO_PROMPT = """\
## MODO: DISCURSO / PARTE CON ESTRUCTURA

Entregas el guion de una parte con esqueleto numerado explícito.

FORMATO DE SALIDA:

1. Introducción
   - Algo concreto que enganche: una imagen del mundo real, una pregunta al
     auditorio, un dato que no esperan. Lo que pida el tema.

2. Desarrollo
   - Dividido en pasos o puntos con título propio, los que necesite el tema.
   - Acotaciones escénicas entre paréntesis y en línea propia, para que el
     orador sepa qué hacer: (Leer Esdras 7:10), (Pausa), (Deja que respondan).
   - Después de cada lectura, una pregunta que lleve al auditorio a la expresión
     clave del texto, y esa expresión entrecomillada.
   - Cada punto vuelve a la imagen de la introducción antes de pasar al
     siguiente.

3. Conclusión
   - Por qué merece la pena el esfuerzo, y qué gana quien lo haga.

LONGITUD: de 400 a 700 palabras según la duración que pida el usuario, a razón
de unas 130 palabras por minuto de exposición. Si no dice duración, apunta a 5
minutos.\
"""


_PRESENTACION_PROMPT = """\
## MODO: PRESENTACIÓN, ORACIÓN Y PROGRAMA DE ACTO

Entregas un guion para leerse o decirse en un acto (boda, presentación de un
discursante, programa de una reunión especial).

FORMATO DE SALIDA:
- Secciones rotuladas como encabezados de Markdown: "Apertura y bienvenida",
  "Oración inicial", "Introducción al discurso", "Cierre y recordatorios finales".
- El texto que se dice va ENTRE COMILLAS: es guion, no resumen.
- Acotaciones escénicas con guiones largos, dentro del párrafo:
  —miras a los novios—, —señalas físicamente hacia un lateral—.
- Tono ceremonioso pero cercano y hablado: es un acto entre conocidos, no un
  trámite. Cariñoso sin empalagar, y sin frases hechas de discurso.
- Si hay ORACIÓN, esta es su estructura: te diriges a Jehová como Padre →
  motivo de alegría → agradecimiento → peticiones concretas (por los novios, por
  el conferenciante, por el oficiante) → fórmula de cierre canónica:
  "te rogamos que aceptes esta oración que te hacemos llegar por el único medio
  que has dejado para ello: tu Hijo Jesús, nuestro Rey. Amén."
- Los recordatorios logísticos van en lista, cada uno con su encabezado en
  negrita: **En primer lugar, respecto a las fotografías:**, **Sentido de
  circulación:**, **Logística del salón:**.\
"""


_INVESTIGACION_PROMPT = """\
## MODO: INVESTIGACIÓN PROFUNDA

Entregas un informe documentado sobre el tema que te ha dado el usuario, tras
haber consultado MUCHAS publicaciones (no dos ni tres).

FORMATO DE SALIDA:

1. "## Resumen ejecutivo" — de 5 a 8 líneas con lo esencial, escrito para
   alguien que solo va a leer eso.
2. Secciones con encabezados de Markdown (##), una por cada bloque temático que
   hayas investigado. Dentro, párrafos cortos y viñetas.
3. CADA afirmación relevante lleva su fuente entre paréntesis, con publicación,
   fecha y página o párrafo: "(La Atalaya, 15 de mayo de 2015, pág. 12, párr. 4)",
   "(Isaías 58:12)". Una afirmación sin fuente es un error del informe.
4. "## Lo que no encontré" — qué preguntas se quedaron sin respuesta en las
   publicaciones consultadas. Esta sección es OBLIGATORIA aunque esté vacía
   ("No quedaron huecos relevantes"). Decir lo que falta es parte del trabajo.
5. "## Fuentes consultadas" — lista de todo lo que abriste, una línea por
   publicación.

PROHIBIDO rellenar con conocimiento general, con lo que "se suele decir" o con
razonamientos propios presentados como si vinieran de las publicaciones. Si una
sub-pregunta no tiene respuesta en lo consultado, va a "Lo que no encontré".\
"""


CHAT_MODES: dict[str, ModeSpec] = {
    "analisis": ModeSpec(
        id="analisis",
        label="Análisis con referencias",
        hint="Pregunta lo que quieras y busco en las publicaciones",
        prompt=_ANALISIS_PROMPT,
        max_tokens=2200,
        min_tool_rounds=2,
        followups=(
            "¿Qué dice el contexto del capítulo?",
            "Dame un comentario de 30 segundos",
            "¿Cómo lo aplico en el ministerio?",
        ),
        examples=(
            "¿Qué significa ser «reparadores de brechas»?",
            "¿Por qué Jeremías siguió predicando?",
            "Explícame el contexto de Filipenses 2",
        ),
    ),
    "comentario": ModeSpec(
        id="comentario",
        label="Comentario de 30 s",
        hint="Pega el punto o el versículo y te lo redacto",
        prompt=_COMENTARIO_PROMPT,
        max_tokens=900,
        min_tool_rounds=2,
        followups=(
            "Dame una versión más corta",
            "Cámbiame el enfoque emocional",
            "¿Y si lo enfoco al ministerio?",
        ),
        examples=(
            "Comentario de Isaías 58:12",
            "Comentario sobre la paciencia de Jehová",
            "Comentario del párrafo 8 del estudio",
        ),
    ),
    "ilustracion": ModeSpec(
        id="ilustracion",
        label="Ilustración",
        hint="Dime el punto y te busco una ilustración real",
        prompt=_ILUSTRACION_PROMPT,
        max_tokens=1200,
        min_tool_rounds=2,
        followups=(
            "Dame otra ilustración distinta",
            "Acórtala para un comentario",
            "¿Qué versículo la respalda mejor?",
        ),
        examples=(
            "Ilustración sobre la constancia en el ministerio",
            "Ilustración sobre el aguante en las pruebas",
            "Ilustración para Juan 13:34, 35",
        ),
    ),
    "discurso": ModeSpec(
        id="discurso",
        label="Discurso o parte",
        hint="Dime el tema y la duración y te monto el guion",
        prompt=_DISCURSO_PROMPT,
        max_tokens=2600,
        min_tool_rounds=3,
        followups=(
            "Alarga el paso 2",
            "Cámbiame la ilustración de entrada",
            "Dame la conclusión más breve",
        ),
        examples=(
            "Discurso de 5 minutos sobre estudiar bien",
            "Parte de 10 minutos sobre Esdras 7:10",
            "Guion para la lectura de Isaías 58",
        ),
    ),
    "presentacion": ModeSpec(
        id="presentacion",
        label="Presentación y oración",
        hint="Dime el acto y te escribo el guion completo",
        prompt=_PRESENTACION_PROMPT,
        max_tokens=1800,
        min_tool_rounds=1,
        followups=(
            "Añade los recordatorios de logística",
            "Hazme la oración de cierre",
            "Dame una bienvenida más breve",
        ),
        examples=(
            "Programa para una boda en el Salón del Reino",
            "Presentación de un discursante visitante",
            "Oración inicial para una reunión especial",
        ),
    ),
    # Va el último a propósito: es el más caro y el más lento, y no debe ser lo
    # primero que se pruebe por curiosidad.
    "investigacion": ModeSpec(
        id="investigacion",
        label="Investigación profunda",
        hint="Dime el tema y lo investigo a fondo (varios minutos)",
        prompt=_INVESTIGACION_PROMPT,
        max_tokens=6000,
        min_tool_rounds=6,
        followups=(
            "Profundiza en el punto 2",
            "Dame el resumen para un discurso",
            "¿Qué publicaciones no has consultado?",
        ),
        examples=(
            "Todo lo que dice La Atalaya sobre el aguante",
            "Estudio completo de Isaías 58",
            "Investiga el trasfondo histórico de Ester",
        ),
        deep=True,
    ),
}


def deep_modes() -> set[str]:
    """Ids de los modos que se resuelven en segundo plano."""
    return {spec.id for spec in CHAT_MODES.values() if spec.deep}


def get_mode(mode_id: str | None) -> ModeSpec:
    """
    Devuelve el ModeSpec de ``mode_id``.

    Tolerante a propósito: ``None``, cadena vacía o id desconocido degradan al
    modo por defecto. Un cliente antiguo que no manda modo, o uno nuevo que
    manda un modo que este backend no conoce, no deben recibir un error.
    """
    if not mode_id:
        return CHAT_MODES[DEFAULT_MODE]
    return CHAT_MODES.get(str(mode_id).strip().lower(), CHAT_MODES[DEFAULT_MODE])


def list_modes() -> list[dict]:
    """Catálogo de modos para ``GET /api/chat/modes``. Sin los prompts."""
    return [spec.to_dict() for spec in CHAT_MODES.values()]
