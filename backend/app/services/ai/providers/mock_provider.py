"""
MockProvider — proveedor de IA simulado para desarrollo.

Genera respuestas realistas token a token sin llamar a ningún LLM real.
Útil para:
  - Desarrollo frontend sin API key
  - Tests end-to-end del streaming SSE
  - Demos

La latencia simulada y el contenido mockeo están basados en la skill
solicitada, para que la UI se pueda probar con salidas realistas.
"""

import asyncio
from typing import AsyncIterator, Optional
from .base import AIEngineProvider, ProviderConfig, TokenChunk


# ─── Respuestas mock por skill ───────────────────────────────────
# Cada entrada es una lista de "tokens" que se emitirán secuencialmente.

_MOCK_RESPONSES: dict[str, list[str]] = {
    "summary": [
        "## ", "Resumen ", "estructurado\n\n",
        "El ", "pasaje ", "analizado ", "presenta ", "una ", "metáfora ",
        "pastoral ", "que ", "establece ", "una ", "relación ", "íntima ",
        "entre ", "el ", "creyente ", "y ", "Dios.\n\n",
        "**Tema central**: ", "La ", "provisión ", "divina ", "como ",
        "pastor ", "que ", "guía, ", "protege ", "y ", "conforta.\n\n",
        "**Estructura**:\n",
        "1. ", "Afirmación ", "inicial ", "(v.1)\n",
        "2. ", "Provisión ", "y ", "reposo ", "(v.2-3)\n",
        "3. ", "Valle ", "y ", "presencia ", "(v.4)\n",
        "4. ", "Banquete ", "y ", "unción ", "(v.5)\n",
        "5. ", "Permanencia ", "final ", "(v.6)",
    ],
    "explain_simple": [
        "Imagina ", "que ", "Dios ", "es ", "como ", "un ", "pastor ",
        "que ", "cuida ", "a ", "sus ", "ovejas.\n\n",
        "Las ", "ovejas ", "no ", "pueden ", "defenderse ", "solas, ",
        "así ", "que ", "necesitan ", "a ", "alguien ", "que ",
        "las ", "guíe ", "hacia ", "buenos ", "pastos ", "y ",
        "agua ", "tranquila.\n\n",
        "El ", "pastor ", "las ", "protege ", "de ", "los ", "peligros ",
        "y ", "las ", "busca ", "si ", "se ", "pierden.\n\n",
        "Así ", "es ", "como ", "Dios ", "cuida ", "de ", "nosotros: ",
        "con ", "atención ", "personal ", "y ", "amor ", "constante.",
    ],
    "key_ideas": [
        "## ", "Ideas ", "principales\n\n",
        "- **", "Dios ", "como ", "pastor**: ",
        "relación ", "personal ", "e ", "íntima\n",
        "- **", "Provisión ", "completa**: ",
        "\"nada ", "me ", "faltará\"\n",
        "- **", "Reposo ", "intencional**: ",
        "pastos ", "y ", "aguas ", "de ", "reposo\n",
        "- **", "Presencia ", "en ", "el ", "valle**: ",
        "no ", "elimina ", "el ", "peligro, ",
        "lo ", "transforma\n",
        "- **", "Victoria ", "visible**: ",
        "mesa ", "ante ", "los ", "enemigos\n",
        "- **", "Permanencia ", "eterna**: ",
        "morar ", "en ", "la ", "casa ", "del ", "Señor",
    ],
    "meditation_questions": [
        "## ", "Preguntas ", "para ", "meditar\n\n",
        "1. ", "¿Qué ", "significa ", "para ", "ti ",
        "decir ", "\"mi ", "pastor\" ", "en ", "lugar ",
        "de ", "\"el ", "pastor\"?\n\n",
        "2. ", "¿En ", "qué ", "\"valle ", "de ", "sombra\" ",
        "te ", "encuentras ", "hoy?\n\n",
        "3. ", "¿Cómo ", "has ", "experimentado ",
        "la ", "provisión ", "divina ", "en ", "tu ", "vida?\n\n",
        "4. ", "¿Qué ", "enemigos ", "\"presencian\" ",
        "tu ", "mesa ", "aderezada?\n\n",
        "5. ", "¿Qué ", "cambiaría ", "en ", "tu ",
        "vida ", "si ", "creyeras ", "realmente ",
        "que ", "el ", "bien ", "y ", "la ", "misericordia ",
        "te ", "\"persiguen\"?",
    ],
    "connections": [
        "## ", "Conexiones ", "con ", "otros ", "pasajes\n\n",
        "**Isaías ", "40:11** — ",
        "\"Como ", "pastor ", "apacentará ", "su ", "rebaño\". ",
        "Paralelo ", "directo ", "con ", "la ", "imagen ", "del ", "Salmo ", "23.\n\n",
        "**Ezequiel ", "34:15** — ",
        "\"Yo ", "mismo ", "apacentaré ", "mis ", "ovejas\". ",
        "Dios ", "reafirma ", "su ", "rol ", "pastoral.\n\n",
        "**Juan ", "10:11** — ",
        "\"Yo ", "soy ", "el ", "buen ", "pastor\". ",
        "Cristo ", "se ", "identifica ", "con ", "esta ", "metáfora.\n\n",
        "**1 ", "Pedro ", "2:25** — ",
        "\"El ", "Pastor ", "y ", "Obispo ", "de ", "vuestras ", "almas\". ",
        "Aplicación ", "mesiánica.",
    ],
    "mind_map": [
        '{"', 'root', '": ', '"', 'Salmo 23', '", ',
         '"', 'nodes', '": [',
         '{"', 'id', '": ', '"1', '", ', '"', 'label', '": ', '"', 'El Pastor', '", ',
         '"', 'parent', '": ', '"root', '", ', '"', 'type', '": ', '"', 'concept', '"}, ',
         '{"', 'id', '": ', '"2', '", ', '"', 'label', '": ', '"', 'Provisión', '", ',
         '"', 'parent', '": ', '"1', '", ', '"', 'type', '": ', '"', 'theme', '"}, ',
         '{"', 'id', '": ', '"3', '", ', '"', 'label', '": ', '"', 'Reposo', '", ',
         '"', 'parent', '": ', '"1', '", ', '"', 'type', '": ', '"', 'theme', '"}, ',
         '{"', 'id', '": ', '"4', '", ', '"', 'label', '": ', '"', 'Valle de sombra', '", ',
         '"', 'parent', '": ', '"1', '", ', '"', 'type', '": ', '"', 'trial', '"}, ',
         '{"', 'id', '": ', '"5', '", ', '"', 'label', '": ', '"', 'Banquete', '", ',
         '"', 'parent', '": ', '"1', '", ', '"', 'type', '": ', '"', 'victory', '"}, ',
         '{"', 'id', '": ', '"6', '", ', '"', 'label', '": ', '"', 'Casa del Señor', '", ',
         '"', 'parent', '": ', '"1', '", ', '"', 'type', '": ', '"', 'destination', '"}, ',
         '{"', 'id', '": ', '"7', '", ', '"', 'label', '": ', '"', 'Nada me faltará', '", ',
         '"', 'parent', '": ', '"2', '", ', '"', 'type', '": ', '"', 'verse', '"}, ',
         '{"', 'id', '": ', '"8', '", ', '"', 'label', '": ', '"', 'Aguas de reposo', '", ',
         '"', 'parent', '": ', '"3', '", ', '"', 'type', '": ', '"', 'verse', '"}, ',
         '{"', 'id', '": ', '"9', '", ', '"', 'label', '": ', '"', 'Vara y cayado', '", ',
         '"', 'parent', '": ', '"4', '", ', '"', 'type', '": ', '"', 'verse', '"}, ',
         '{"', 'id', '": ', '"10', '", ', '"', 'label', '": ', '"', 'Copa rebosando', '", ',
         '"', 'parent', '": ', '"5', '", ', '"', 'type', '": ', '"', 'verse', '"}',
         ']}',
    ],
    "keywords": [
        "## ", "Palabras ", "clave\n\n",
        "- ", "Pastor ", "(", "hebreo ", "רָעָה", ")\n",
        "- ", "Provisión\n",
        "- ", "Reposo\n",
        "- ", "Valle ", "de ", "sombra\n",
        "- ", "Vara ", "y ", "cayado\n",
        "- ", "Unción\n",
        "- ", "Misericordia ", "(", "hebreo ", "חֶסֶד", ")\n",
        "- ", "Casa ", "de ", "Jehová",
    ],
}


class MockProvider(AIEngineProvider):
    """Proveedor mock que simula streaming de un LLM real."""

    @property
    def name(self) -> str:
        return "mock"

    async def stream_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> AsyncIterator[TokenChunk]:
        # Detectar la skill desde el system prompt para mockear respuesta adecuada
        skill = self._detect_skill(system_prompt)
        tokens = _MOCK_RESPONSES.get(skill, _MOCK_RESPONSES["summary"])

        for i, token in enumerate(tokens):
            # Latencia simulada variable (20-60ms por token)
            await asyncio.sleep(0.03 + (len(token) * 0.005))
            is_last = i == len(tokens) - 1
            yield TokenChunk(
                text=token,
                finish_reason="stop" if is_last else None,
            )

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        config: ProviderConfig,
    ) -> str:
        chunks: list[str] = []
        async for chunk in self.stream_completion(system_prompt, user_prompt, config):
            chunks.append(chunk.text)
        return "".join(chunks)

    async def health_check(self) -> bool:
        return True

    def _detect_skill(self, system_prompt: str) -> str:
        """Extrae la skill del system prompt para mockear respuesta adecuada."""
        for skill in _MOCK_RESPONSES:
            if skill in system_prompt.lower():
                return skill
        return "summary"
