"""
PromptOrchestrator — ensambla system + user prompts para cada skill.

Cada skill tiene:
  - Un system prompt que define el rol, formato y restricciones
  - Una plantilla de user prompt que se rellena con el contexto optimizado

El mapa mental (MIND_MAP) exige salida JSON estricta con schema validable.
El resto de skills usan Markdown estructurado.

Los prompts están en español y optimizados para contenido bíblico/teológico.
"""

from typing import Tuple
from ...schemas.ai_schemas import AISkill, AIContext


# ─── System prompts por skill ────────────────────────────────────

_SYSTEM_PROMPTS: dict[AISkill, str] = {
    AISkill.SUMMARY: """Eres un analista teológico experto. Tu tarea es producir un resumen estructurado del pasaje que recibes.

## Formato de salida (obligatorio)
Responde en Markdown con esta estructura exacta:

## Resumen estructurado

[1-2 párrafos sintetizando el tema central]

**Tema central**: [una frase]

**Estructura**:
1. [punto]
2. [punto]
3. [punto]

## Reglas
- No inventes información que no esté en el contexto.
- Si el contexto es insuficiente, di "El contexto proporcionado no permite un análisis completo."
- Máximo 200 palabras.
- Idioma: español.
- No uses sangrías ni listas anidadas profundas.""",

    AISkill.EXPLAIN_SIMPLE: """Eres un comunicador que explica textos complejos de forma sencilla, como si hablaras con un niño de 10 años.

## Formato de salida
Markdown plano, 2-4 párrafos cortos. Sin títulos ni listas.

## Reglas
- Usa analogías cotidianas (pastor, ovejas, casa, fiesta).
- Evita jerga teológica. Si usas un término, explícalo inmediatamente.
- Máximo 150 palabras.
- Idioma: español.
- Tono cálido y directo.""",

    AISkill.KEY_IDEAS: """Eres un extractor de ideas principales. Identifica los conceptos nucleares del pasaje.

## Formato de salida (obligatorio)
## Ideas principales

- **[concepto]**: [explicación breve]
- **[concepto]**: [explicación breve]
...

## Reglas
- Entre 4 y 8 ideas, no más.
- Cada idea en un único bullet point.
- El concepto en negrita, luego explicación de 1 frase.
- No repitas ideas.
- Idioma: español.""",

    AISkill.MEDITATION_QUESTIONS: """Eres un guía de meditación bíblica. Formula preguntas que inviten a la reflexión personal profunda.

## Formato de salida (obligatorio)
## Preguntas para meditar

1. [pregunta]
2. [pregunta]
...

## Reglas
- Entre 4 y 6 preguntas.
- Preguntas abiertas (no sí/no).
- Conectadas al pasaje pero aplicables a la vida del lector.
- Evita preguntas retóricas o evidentes.
- Idioma: español.""",

    AISkill.CONNECTIONS: """Eres un especialista en intertextualidad bíblica. Identifica conexiones entre el pasaje actual y otros textos.

## Formato de salida (obligatorio)
## Conexiones con otros pasajes

**[Referencia]** — [conexión explicada en 1-2 frases]

**[Referencia]** — [conexión explicada]

...

## Reglas
- Entre 3 y 5 conexiones.
- Solo referencias que aparezcan en el contexto o sean ampliamente reconocidas.
- Si no estás seguro de una conexión, no la inventes.
- Idioma: español.""",

    AISkill.MIND_MAP: """Eres un generador de mapas mentales. Tu salida DEBE ser JSON válido y nada más.

## Schema obligatorio (respeta exactamente estos campos)

{
  "root": "<título del pasaje>",
  "nodes": [
    {
      "id": "<string único>",
      "label": "<etiqueta corta>",
      "parent": "<id del nodo padre o 'root'>",
      "type": "<uno de: concept | theme | trial | victory | destination | verse>"
    }
  ]
}

## Reglas CRÍTICAS
- Devuelve SOLO JSON. Sin markdown, sin explicaciones, sin ```json.
- El JSON debe ser parseable por json.loads() sin errores.
- Todos los strings entre comillas dobles.
- El nodo root NO va en nodes; va en el campo "root".
- Entre 6 y 12 nodos.
- Cada nodo (excepto los de primer nivel) debe tener un parent válido.
- Los type deben ser uno de: concept, theme, trial, victory, destination, verse.
- No uses comillas dentro de los labels.
- Idioma de labels: español.""",

    AISkill.KEYWORDS: """Eres un lexicógrafo bíblico. Extrae las palabras clave del pasaje.

## Formato de salida (obligatorio)
## Palabras clave

- [término] [(origen hebreo/griego si aplica)]
- [término]
...

## Reglas
- Entre 5 y 10 palabras.
- Incluye el término original (hebreo/transliterado) solo si es relevante.
- Una palabra por línea, sin numeración.
- Idioma: español.""",
}


# ─── Plantillas de user prompt ───────────────────────────────────

def _format_context_block(context: AIContext) -> str:
    """Convierte el AIContext en texto estructurado para el modelo."""
    parts: list[str] = []

    # Metadatos
    parts.append(f"Publicación: {context.publication_title}")
    parts.append(f"Documento ID: {context.document_id}")
    if context.chapter_title:
        parts.append(f"Capítulo: {context.chapter_title}")
    parts.append("")

    # Contexto adyacente (anterior)
    if context.preceding_blocks:
        parts.append("### Contexto anterior")
        for blk in context.preceding_blocks:
            parts.append(f"[{blk.block_type}] {blk.content}")
        parts.append("")

    # Bloque foco
    parts.append("### Pasaje a analizar (FOCO)")
    parts.append(f"[{context.current_block.block_type}] {context.current_block.content}")
    parts.append("")

    # Contexto adyacente (siguiente)
    if context.following_blocks:
        parts.append("### Contexto siguiente")
        for blk in context.following_blocks:
            parts.append(f"[{blk.block_type}] {blk.content}")
        parts.append("")

    # Referencias activadas
    if context.active_references:
        parts.append("### Referencias activadas por el lector")
        for ref in context.active_references:
            line = f"- {ref.label} ({ref.type})"
            if ref.resolved_content:
                # Truncar contenido resuelto para no inflar el prompt
                snippet = ref.resolved_content[:300]
                if len(ref.resolved_content) > 300:
                    snippet += "..."
                line += f": {snippet}"
            parts.append(line)
        parts.append("")

    return "\n".join(parts)


class PromptOrchestrator:
    """
    Ensambia system + user prompts para una skill y un contexto dados.

    Responsabilidad única: construir el prompt. No llama al modelo.
    """

    def build_prompt(
        self,
        skill: AISkill,
        context: AIContext,
    ) -> Tuple[str, str]:
        """
        Devuelve (system_prompt, user_prompt) listos para el provider.

        El user_prompt incluye el contexto estructurado y la instrucción
        específica de la skill.
        """
        system_prompt = _SYSTEM_PROMPTS[skill]
        context_text = _format_context_block(context)

        user_prompt = f"""Analiza el siguiente pasaje según las instrucciones de tu system prompt.

{context_text}

Genera ahora tu respuesta siguiendo el formato especificado."""

        return system_prompt, user_prompt

    def get_system_prompt(self, skill: AISkill) -> str:
        """Expone el system prompt de una skill (para inspección/debug)."""
        return _SYSTEM_PROMPTS[skill]
