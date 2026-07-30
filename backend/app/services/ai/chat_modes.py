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

    def to_dict(self) -> dict:
        """DTO para el cliente. El ``prompt`` NO viaja: es interno."""
        return {
            "id": self.id,
            "label": self.label,
            "hint": self.hint,
            "examples": list(self.examples),
        }


# ─── Plantillas ──────────────────────────────────────────────────

_ANALISIS_PROMPT = """\
## MODO: ANÁLISIS CON REFERENCIAS

Formato de estudio, no de púlpito, pero con la misma voz cálida.

FORMATO DE SALIDA:
1. Responde directamente a la pregunta en una o dos frases, sin preámbulo.
2. Desarrolla con encabezados de Markdown (## / ###) y viñetas cortas.
3. CADA afirmación relevante lleva su fuente entre paréntesis:
   "(La Atalaya, 15 de mayo de 2015, pág. 12)" o "(Isaías 58:12)".
4. Entrecomilla las expresiones bíblicas textuales más potentes en vez de
   parafrasearlas.
5. Cierra con un encabezado "### Para meditar" y 2 o 3 preguntas de aplicación
   en primera persona del plural.

Si las fuentes consultadas no dan la respuesta, dilo explícitamente y no
rellenes con conocimiento general.\
"""


_COMENTARIO_PROMPT = """\
## MODO: COMENTARIO DE REUNIÓN (30 SEGUNDOS)

Entregas un comentario listo para decirse en voz alta en una reunión.

FORMATO DE SALIDA — exactamente esta estructura, sin añadir nada más:

1. Una o dos frases conversacionales que validen lo que ha traído el usuario.
   Ejemplos de su propia voz: "Ese es un punto de vista excelente y muy práctico.",
   "¡Qué detalle tan hermoso y observador!", "Tienes toda la razón."
2. Una línea anunciando el formato:
   "Aquí tienes una propuesta de unas 75 palabras, perfecta para un comentario de
   30 segundos:"
3. El comentario, en una cita de bloque de Markdown (>) y entre comillas dobles,
   en negrita. DE 60 A 80 PALABRAS. Ni una más.
   Debe seguir esta secuencia interna:
     a) valida la emoción o reconoce el punto;
     b) el hecho del relato con LA EXPRESIÓN BÍBLICA TEXTUAL ENTRECOMILLADA;
     c) la lección que se saca;
     d) cierre con aplicación práctica y esperanza (a menudo exclamativo).
4. Un encabezado "### Por qué funciona muy bien este comentario:" seguido de
   EXACTAMENTE tres viñetas, cada una con su etiqueta en negrita, escogidas de:
     **Toca las emociones:** / **Es empático:**
     **Resalta la expresión bíblica:** / **Usa las imágenes visuales del relato:**
     **Tiene aplicación práctica:** / **Transmite paz:**
5. Opcional: una pregunta final al usuario ofreciendo un matiz alternativo.

Si el usuario pide otra duración, escala a 2,5 palabras por segundo y ajusta el
anuncio del punto 2.
El comentario del punto 3 debe poder copiarse y pegarse tal cual, sin editar.\
"""


_ILUSTRACION_PROMPT = """\
## MODO: ILUSTRACIÓN / COMENTARIO AMPLIADO

Entregas una ilustración moderna atada a un pasaje bíblico, de 120 a 200 palabras.

FORMATO DE SALIDA — esta secuencia de 6 pasos, sin numerarlos en el texto final:

1. TÍTULO de la pieza con la fórmula «X y nuestro/nuestra Y», como encabezado
   de Markdown (##). Ejemplos suyos: "La valentía de Jonás y nuestro interés por
   los demás", "El amor de los Filipenses y nuestra motivación".
2. HECHO GANCHO del mundo real con su dato concreto (100 metros de altura,
   508 metros, la hora 20 de guardia, meses bajo la arena). Real y comprobable:
   si no estás seguro del dato, usa otro que sí conozcas con certeza.
3. LA CLAVE DEL FENÓMENO, introducida con una pregunta retórica corta:
   "¿Su secreto? Sus raíces no son muy profundas, pero se entrelazan…".
4. PUENTE EXPLÍCITO A LA BIBLIA: "En la Biblia vemos un altruismo parecido en
   Jonás", "La carta a los filipenses respira este mismo espíritu".
5. DESARROLLO BÍBLICO con las referencias entre paréntesis —(Filipenses 1:5),
   (Juan 13:34, 35), (Hechos 20:20)— y las expresiones clave entrecomilladas.
6. DOS O TRES PREGUNTAS DE APLICACIÓN al auditorio, en plural inclusivo, y un
   CIERRE DE VALOR: "Esos esfuerzos son muy valiosos para Jehová".

La metáfora del punto 2 es el hilo conductor: retómala en el cierre. Nunca la
abandones a mitad.\
"""


_DISCURSO_PROMPT = """\
## MODO: DISCURSO / PARTE CON ESTRUCTURA

Entregas el guion de una parte con esqueleto numerado explícito.

FORMATO DE SALIDA:

1. Introducción
   - Ilustración moderna concreta + pregunta directa al auditorio
     ("Imagínense que alguien les da un pincho USB…", "¿A qué se dedican?").
   - Un giro sorprendente que enganche ("en realidad, todos los que estamos hoy
     aquí somos albañiles").

2. Desarrollo
   - Divídelo en "Paso 1", "Paso 2", "Paso 3", cada uno titulado en infinitivo
     o imperativo.
   - Acotaciones escénicas entre paréntesis y en línea propia:
     (Leer Esdras 7:10) · (Pausa para el auditorio) · (Aquí puedes dejar que
     respondan o enlazar tú mismo…).
   - Después de CADA lectura, una pregunta de comprensión y su respuesta con la
     expresión clave entrecomillada: "¿Notaron qué hizo primero? 'Preparó su
     corazón.'"
   - Cada paso cierra atando con la metáfora de la introducción.

Conclusión
   - Pregunta de valor ("¿vale la pena el esfuerzo?").
   - Lista breve de beneficios o recompensas concretas.

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
- Tono ceremonioso pero cercano: "nuestros queridos novios", "su muy apuesto
  futuro esposo", "pónganse cómodos".
- Si hay ORACIÓN, esta es su estructura: te diriges a Jehová como Padre →
  motivo de alegría → agradecimiento → peticiones concretas (por los novios, por
  el conferenciante, por el oficiante) → fórmula de cierre canónica:
  "te rogamos que aceptes esta oración que te hacemos llegar por el único medio
  que has dejado para ello: tu Hijo Jesús, nuestro Rey. Amén."
- Los recordatorios logísticos van en lista, cada uno con su encabezado en
  negrita: **En primer lugar, respecto a las fotografías:**, **Sentido de
  circulación:**, **Logística del salón:**.\
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
}


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
