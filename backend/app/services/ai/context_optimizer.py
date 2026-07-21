"""
ContextOptimizer — gestiona la ventana de contexto y optimiza tokens.

Estrategia:
  1. **Presupuesto de tokens**: cada skill tiene un budget distinto.
     El system prompt + user prompt + max_tokens de respuesta no debe
     exceder el límite del modelo.

  2. **Prioridad de contexto**: el bloque foco SIEMPRE se incluye completo.
     El contexto adyacente se trunca si excede el budget.
     Orden de prioridad (de mayor a menor):
       a. Bloque foco (current_block)
       b. Referencias activadas (resolved_content truncado)
       c. Bloques adyacentes inmediatos (±1)
       d. Bloques más lejanos (truncados o eliminados)

  3. **Estimación de tokens**: heurística simple 1 token ≈ 4 chars.
     Para producción, usar tiktoken (OpenAI) o el tokenizador del modelo.

  4. **Truncamiento inteligente**: al truncar, conservar oraciones completas
     (cortar en punto, no a mitad de frase).
"""

from typing import List
from ...schemas.ai_schemas import AISkill, AIContext, BlockContext, ReferenceContext


# ─── Heurística de tokens ────────────────────────────────────────

CHARS_PER_TOKEN = 4  # Aproximación para español (más conservadora que inglés)


def estimate_tokens(text: str) -> int:
    """Estima el número de tokens de un texto (heurística 1 token ≈ 4 chars)."""
    return max(1, len(text) // CHARS_PER_TOKEN)


# ─── Presupuestos por skill ──────────────────────────────────────

# Budget total del prompt (system + user) en tokens.
# El max_tokens de respuesta se suma a esto para no exceder el límite del modelo.
_SKILL_BUDGETS: dict[AISkill, int] = {
    AISkill.SUMMARY: 1500,
    AISkill.EXPLAIN_SIMPLE: 1200,
    AISkill.KEY_IDEAS: 1500,
    AISkill.MEDITATION_QUESTIONS: 1200,
    AISkill.CONNECTIONS: 1800,
    AISkill.MIND_MAP: 2000,  # JSON necesita más espacio
    AISkill.KEYWORDS: 1000,
}

# max_tokens de respuesta por skill
_SKILL_MAX_TOKENS: dict[AISkill, int] = {
    AISkill.SUMMARY: 400,
    AISkill.EXPLAIN_SIMPLE: 300,
    AISkill.KEY_IDEAS: 400,
    AISkill.MEDITATION_QUESTIONS: 300,
    AISkill.CONNECTIONS: 500,
    AISkill.MIND_MAP: 800,  # JSON estructurado
    AISkill.KEYWORDS: 250,
}


# ─── Truncamiento inteligente ────────────────────────────────────

def truncate_at_sentence(text: str, max_chars: int) -> str:
    """Trunca texto conservando oraciones completas (corta en punto)."""
    if len(text) <= max_chars:
        return text

    truncated = text[:max_chars]
    # Buscar el último punto antes del límite
    last_period = max(
        truncated.rfind(". "),
        truncated.rfind(".\n"),
        truncated.rfind("。"),
    )
    if last_period > max_chars * 0.6:  # Si el punto está en el último 40%
        return truncated[: last_period + 1]
    return truncated + "..."


# ─── Optimizador ─────────────────────────────────────────────────


class ContextOptimizer:
    """
    Optimiza el AIContext para que quepa en el budget de tokens de la skill.

    No modifica el contexto original; devuelve una versión optimizada.
    """

    def optimize(
        self,
        context: AIContext,
        skill: AISkill,
        system_prompt_tokens: int,
    ) -> AIContext:
        """
        Devuelve un AIContext optimizado para el budget de la skill.

        Args:
            context: Contexto original del frontend
            skill: Skill solicitada (determina el budget)
            system_prompt_tokens: Tokens del system prompt (precalculado)

        Returns:
            AIContext con bloques/referencias truncados si era necesario
        """
        budget = _SKILL_BUDGETS[skill]
        # Reservar espacio para system prompt + user prompt scaffolding
        available_for_context = budget - system_prompt_tokens - 200  # 200 para scaffolding

        if available_for_context < 200:
            # Budget muy ajustado: solo el bloque foco, truncado
            return self._minimal_context(context)

        # 1. Bloque foco — siempre completo (o truncado si es enorme)
        focus_tokens = estimate_tokens(context.current_block.content)
        focus_budget = min(focus_tokens, available_for_context // 2)
        focus_content = truncate_at_sentence(
            context.current_block.content,
            focus_budget * CHARS_PER_TOKEN,
        )
        current_block = BlockContext(
            block_id=context.current_block.block_id,
            block_type=context.current_block.block_type,
            content=focus_content,
        )

        remaining = available_for_context - estimate_tokens(focus_content)

        # 2. Referencias activadas (truncar resolved_content)
        active_refs, refs_tokens = self._optimize_references(
            context.active_references, remaining // 3
        )
        remaining -= refs_tokens

        # 3. Bloques adyacentes (repartir el restante)
        preceding, following = self._optimize_adjacent(
            context.preceding_blocks,
            context.following_blocks,
            remaining,
        )

        return AIContext(
            current_block=current_block,
            preceding_blocks=preceding,
            following_blocks=following,
            chapter_title=context.chapter_title,
            publication_title=context.publication_title,
            document_id=context.document_id,
            active_references=active_refs,
            language=context.language,
        )

    def get_max_tokens(self, skill: AISkill) -> int:
        """max_tokens de respuesta para una skill."""
        return _SKILL_MAX_TOKENS[skill]

    def estimate_total_tokens(
        self,
        system_prompt: str,
        user_prompt: str,
        skill: AISkill,
    ) -> int:
        """Estima el total de tokens que consumirá la request."""
        return (
            estimate_tokens(system_prompt)
            + estimate_tokens(user_prompt)
            + _SKILL_MAX_TOKENS[skill]
        )

    # ─── Internos ─────────────────────────────────────────────────

    def _minimal_context(self, context: AIContext) -> AIContext:
        """Contexto mínimo: solo el bloque foco, muy truncado."""
        truncated = truncate_at_sentence(context.current_block.content, 800)
        return AIContext(
            current_block=BlockContext(
                block_id=context.current_block.block_id,
                block_type=context.current_block.block_type,
                content=truncated,
            ),
            preceding_blocks=[],
            following_blocks=[],
            chapter_title=context.chapter_title,
            publication_title=context.publication_title,
            document_id=context.document_id,
            active_references=[],
            language=context.language,
        )

    def _optimize_references(
        self,
        references: List[ReferenceContext],
        budget_tokens: int,
    ) -> tuple[List[ReferenceContext], int]:
        """Trunca el resolved_content de las referencias para caber en budget."""
        if not references:
            return [], 0

        budget_chars = budget_tokens * CHARS_PER_TOKEN
        used = 0
        optimized: List[ReferenceContext] = []

        for ref in references:
            ref_chars = len(ref.label) + 50  # overhead de formato
            if ref.resolved_content:
                available = max(100, budget_chars - used - ref_chars)
                snippet = truncate_at_sentence(ref.resolved_content, available)
                ref_chars += len(snippet)
                optimized.append(
                    ReferenceContext(
                        identifier=ref.identifier,
                        label=ref.label,
                        type=ref.type,
                        resolved_content=snippet,
                    )
                )
            else:
                optimized.append(ref)
            used += ref_chars
            if used >= budget_chars:
                break  # No más referencias

        return optimized, estimate_tokens(" " * used)

    def _optimize_adjacent(
        self,
        preceding: List[BlockContext],
        following: List[BlockContext],
        budget_tokens: int,
    ) -> tuple[List[BlockContext], List[BlockContext]]:
        """Optimiza bloques adyacentes con prioridad a los más cercanos."""
        if budget_tokens < 100:
            return [], []

        budget_chars = budget_tokens * CHARS_PER_TOKEN
        # Repartir 50/50 entre anterior y siguiente
        half_budget = budget_chars // 2

        # Preceding: los últimos son los más cercanos al foco (mayor prioridad)
        prec_optimized: List[BlockContext] = []
        prec_used = 0
        for blk in reversed(preceding):  # del más cercano al más lejano
            if prec_used >= half_budget:
                break
            available = half_budget - prec_used
            content = truncate_at_sentence(blk.content, available)
            prec_optimized.insert(0, BlockContext(
                block_id=blk.block_id,
                block_type=blk.block_type,
                content=content,
            ))
            prec_used += len(content)

        # Following: los primeros son los más cercanos al foco
        foll_optimized: List[BlockContext] = []
        foll_used = 0
        for blk in following:
            if foll_used >= half_budget:
                break
            available = half_budget - foll_used
            content = truncate_at_sentence(blk.content, available)
            foll_optimized.append(BlockContext(
                block_id=blk.block_id,
                block_type=blk.block_type,
                content=content,
            ))
            foll_used += len(content)

        return prec_optimized, foll_optimized
