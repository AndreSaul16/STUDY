"""
Tests del stream SSE de ``ChatService.chat_stream``. Sin red y sin keys.

Cubren el **contrato del stream**, que es lo que rompe al cliente sin que nadie
se entere en el servidor:

  - todo turno termina con un ``done``, también cuando falla. Sin él, el
    consumidor se queda esperando un final que no llega y el composer no vuelve;
  - el ``metadata`` sale siempre, con herramientas o sin ellas: es lo que se
    persiste con el mensaje y lo que pinta el pie "modelo · esfuerzo".
"""

import json
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from app.services.ai.chat_providers import OPENAI, answer_token_cap, native_effort
from app.services.ai.chat_service import TOOL_FAILED, ChatService, tool_failed
from app.services.ai.local_library import from_payload


# ─── Dobles ──────────────────────────────────────────────────────


class _Delta:
    def __init__(self, content: str | None):
        self.content = content


class _Choice:
    def __init__(self, content: str | None, finish_reason: str | None = None):
        self.delta = _Delta(content)
        self.finish_reason = finish_reason


class _Chunk:
    def __init__(self, content: str | None, finish_reason: str | None = None):
        self.choices = [_Choice(content, finish_reason)]
        self.usage = None


class _Mensaje:
    def __init__(self, content: str | None = "", tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []


class _Respuesta:
    def __init__(self, content: str = "", tool_calls=None):
        self.choices = [
            type("C", (), {"message": _Mensaje(content, tool_calls)})()
        ]
        self.usage = None


class _ToolCall:
    """Una tool_call como la devuelve el SDK, con lo que mira el bucle."""

    def __init__(self, name: str, arguments: str = "{}", id: str = "call-1"):
        self.id = id
        self.function = SimpleNamespace(name=name, arguments=arguments)
        self.model_extra: Dict[str, Any] = {}


class _Stream:
    """Async iterable de trozos, como el que devuelve el SDK con stream=True."""

    def __init__(self, textos: List[str]):
        self._textos = textos

    def __aiter__(self):
        async def gen():
            for texto in self._textos:
                yield _Chunk(texto)

        return gen()


class _Completions:
    def __init__(
        self,
        *,
        revienta: bool = False,
        textos: List[str] | None = None,
        tandas: List[List[str]] | None = None,
        rondas: List[List[str]] | None = None,
    ):
        self._revienta = revienta
        self._textos = textos if textos is not None else ["Hola."]
        #: Un lote de trozos por cada llamada CON streaming, para poder ensayar
        #: una primera pasada vacía y una segunda que sí escribe. Cuando se
        #: agotan, se repite el último.
        self._tandas = tandas
        #: Qué herramientas pide el modelo en cada ronda (por nombre). Cuando se
        #: agotan, deja de pedir y el bucle pasa a redactar.
        self._rondas = rondas or []
        self._ronda = 0
        #: Los `messages` de cada llamada. Es la única forma de comprobar qué
        #: se le puso delante al modelo sin salir a la red.
        self.llamadas: List[List[Dict[str, Any]]] = []
        #: Los kwargs completos, para comprobar topes y params de razonamiento.
        self.kwargs: List[Dict[str, Any]] = []
        self._streams = 0

    async def create(self, **kwargs):
        self.llamadas.append(list(kwargs.get("messages") or []))
        self.kwargs.append(dict(kwargs))
        if self._revienta:
            raise RuntimeError("el proveedor dice que no")
        if kwargs.get("stream"):
            if self._tandas:
                indice = min(self._streams, len(self._tandas) - 1)
                self._streams += 1
                return _Stream(self._tandas[indice])
            self._streams += 1
            return _Stream(self._textos)
        if self._ronda < len(self._rondas):
            nombres = self._rondas[self._ronda]
            self._ronda += 1
            return _Respuesta(
                tool_calls=[
                    _ToolCall(nombre, id=f"call-{self._ronda}-{i}")
                    for i, nombre in enumerate(nombres)
                ]
            )
        return _Respuesta("")


class _Cliente:
    def __init__(self, **kwargs):
        self.completions = _Completions(**kwargs)
        self.chat = type("Chat", (), {"completions": self.completions})()


class _Runtime:
    """Lo justo de ``ChatRuntime`` que usa ``chat_stream``."""

    def __init__(
        self, client, inline_reasoning: bool = False, effort: str = ""
    ):
        self.client = client
        self.model = "modelo-de-prueba"
        #: Id STUDY. "" = este modelo no acepta `reasoning_effort` (gpt-4o-mini).
        self.effort = effort
        self.tool_params: Dict[str, Any] = {}
        self.answer_params: Dict[str, Any] = (
            {"reasoning_effort": native_effort(OPENAI, effort)} if effort else {}
        )
        # `chat_stream` mira `provider.inline_reasoning` para saber si tiene
        # que limpiar los bloques <think> del stream (MiniMax los emite).
        self.provider = SimpleNamespace(
            id="openai",
            inline_reasoning=inline_reasoning,
            min_answer_effort=OPENAI.min_answer_effort,
            supports_tool_choice_required=OPENAI.supports_tool_choice_required,
        )

    # Los cálculos reales, no una copia: si la holgura del pensamiento cambia,
    # estos tests hablan de la holgura de verdad.
    def answer_cap(self, visible_tokens: int) -> int:
        return answer_token_cap(OPENAI, self.effort, visible_tokens)

    def retry_params(self) -> Dict[str, Any]:
        if not self.answer_params or not OPENAI.min_answer_effort:
            return {}
        return {"reasoning_effort": OPENAI.min_answer_effort}

    def metadata(self) -> Dict[str, Any]:
        return {
            "provider": "openai",
            "model": self.model,
            "effort": "alto",
            "effort_applied": "high",
            "source": "server",
        }


async def _recoger(servicio, runtime) -> List[str]:
    return [
        evento
        async for evento in servicio.chat_stream(
            [{"role": "user", "content": "hola"}], mode="comentario", runtime=runtime
        )
    ]


def _tipos(eventos: List[str]) -> List[str]:
    return [e.split("\n", 1)[0].removeprefix("event: ") for e in eventos if e.startswith("event:")]


@pytest.fixture()
def servicio(monkeypatch):
    servicio = ChatService()
    # Sin herramientas y sin cargarlas: no hay MCP que levantar en un test.
    servicio.tools = []
    servicio.mcp_tools = []
    servicio._tools_loaded = True
    # Las sugerencias son otra llamada al modelo; aquí sobran.
    monkeypatch.setattr(
        ChatService, "_generate_followups", lambda self, *a, **k: _vacio()
    )
    return servicio


async def _vacio():
    return []


# ─── El `done` de cierre ─────────────────────────────────────────


class TestSiempreCierraConDone:
    @pytest.mark.asyncio
    async def test_un_fallo_del_proveedor_tambien_emite_done(self, servicio):
        runtime = _Runtime(_Cliente(revienta=True))

        tipos = _tipos(await _recoger(servicio, runtime))

        # Cortar tras el `error` dejaba al cliente esperando para siempre.
        assert "error" in tipos
        assert tipos[-1] == "done"

    @pytest.mark.asyncio
    async def test_un_turno_normal_acaba_en_done(self, servicio):
        runtime = _Runtime(_Cliente(textos=["Hola", " mundo."]))

        tipos = _tipos(await _recoger(servicio, runtime))

        assert tipos[-1] == "done"
        assert tipos.count("done") == 1


# ─── El `metadata` ───────────────────────────────────────────────


class TestMetadataSinHerramientas:
    @pytest.mark.asyncio
    async def test_sin_herramientas_sigue_habiendo_metadata(self, servicio):
        """
        Estaba dentro del `if self.tools:`. Con el MCP caído y sin nativas, la
        respuesta se guardaba sin `meta` y el pie "modelo · esfuerzo" del
        mensaje desaparecía sin que nada lo explicara.
        """
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        eventos = await _recoger(servicio, runtime)
        tipos = _tipos(eventos)

        assert "metadata" in tipos
        assert "sources" in tipos
        metadata = next(e for e in eventos if e.startswith("event: metadata"))
        assert "modelo-de-prueba" in metadata


# ─── Biblioteca local del usuario ────────────────────────────────


class TestBibliotecaLocal:
    """
    Los fragmentos .jwpub llegan al modelo y salen como fuentes.

    Son dos cosas distintas y las dos hacen falta: el modelo tiene que poder
    usarlos, y el usuario tiene que VER que se usaron. Un fragmento que entra en
    el prompt sin aparecer en los chips es contenido suyo enviado a un proveedor
    de IA sin dejar rastro.
    """

    @pytest.mark.asyncio
    async def test_sin_fragmentos_el_prompt_es_el_de_siempre(self, servicio):
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        await _recoger(servicio, runtime)

        mensajes = runtime.client.completions.llamadas[0]
        assert [m["role"] for m in mensajes] == ["system", "user"]

    @pytest.mark.asyncio
    async def test_los_fragmentos_van_en_un_system_aparte_antes_del_usuario(
        self, servicio
    ):
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        await _con_biblioteca(servicio, runtime)

        mensajes = runtime.client.completions.llamadas[0]
        assert [m["role"] for m in mensajes] == ["system", "system", "user"]
        # El primero sigue siendo el prompt del sistema, intacto.
        assert "CÓMO INVESTIGAS" in mensajes[0]["content"]
        assert "El aguante da resultado." in mensajes[1]["content"]
        assert "(bt)" in mensajes[1]["content"]

    @pytest.mark.asyncio
    async def test_salen_como_fuentes_aunque_no_se_llame_a_ninguna_herramienta(
        self, servicio
    ):
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        eventos = await _con_biblioteca(servicio, runtime)

        fuentes = next(e for e in eventos if e.startswith("event: sources"))
        assert '"kind": "local"' in fuentes
        assert "Cap\\u00edtulo 3" in fuentes or "Capítulo 3" in fuentes
        assert "jwpub:bt:12" in fuentes

    @pytest.mark.asyncio
    async def test_un_turno_con_biblioteca_sigue_cerrando_con_done(self, servicio):
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        tipos = _tipos(await _con_biblioteca(servicio, runtime))

        assert tipos[-1] == "done"


async def _con_biblioteca(servicio, runtime) -> List[str]:
    fragmentos = from_payload(
        [
            {
                "symbol": "bt",
                "publication": "Damos testimonio",
                "document_title": "Capítulo 3",
                "text": "El aguante da resultado.",
                "document_id": 12,
            }
        ]
    )
    return [
        evento
        async for evento in servicio.chat_stream(
            [{"role": "user", "content": "hola"}],
            mode="comentario",
            runtime=runtime,
            local_snippets=fragmentos,
        )
    ]


# ─── La redacción vacía ──────────────────────────────────────────
#
# El fallo real: Gemini 3.6-flash con esfuerzo "alto" en el modo "comentario"
# (900 tokens). El razonamiento sale del MISMO presupuesto que la respuesta, así
# que se gastaba los 900 pensando y cerraba el stream sin un solo token. El
# backend emitía un `done` limpio, el cliente lo daba por bueno y borraba el
# rastro de herramientas: la pantalla quedaba igual que antes de preguntar,
# "como si nunca hubiera investigado".


class TestRedaccionVacia:
    @pytest.mark.asyncio
    async def test_una_redaccion_vacia_no_pasa_por_turno_bueno(self, servicio):
        runtime = _Runtime(_Cliente(textos=[]))

        tipos = _tipos(await _recoger(servicio, runtime))

        assert "token" not in tipos
        assert "error" in tipos
        assert tipos[-1] == "done"

    @pytest.mark.asyncio
    async def test_el_error_dice_que_hacer(self, servicio):
        runtime = _Runtime(_Cliente(textos=[]))

        eventos = await _recoger(servicio, runtime)

        error = next(e for e in eventos if e.startswith("event: error"))
        assert "esfuerzo" in error

    @pytest.mark.asyncio
    async def test_solo_espacios_cuenta_como_vacio(self, servicio):
        runtime = _Runtime(_Cliente(textos=["   ", "\n"]))

        tipos = _tipos(await _recoger(servicio, runtime))

        assert "error" in tipos

    @pytest.mark.asyncio
    async def test_se_reintenta_sin_razonar_y_se_rescata_el_turno(self, servicio):
        # Primera pasada vacía (se gastó el presupuesto pensando), segunda con
        # el esfuerzo mínimo: escribe.
        runtime = _Runtime(
            _Cliente(tandas=[[], ["Rescatado."]]), effort="alto"
        )

        eventos = await _recoger(servicio, runtime)

        tipos = _tipos(eventos)
        assert "token" in tipos
        assert "error" not in tipos
        # Dos pasadas de redacción, la segunda sin el esfuerzo alto.
        redacciones = [
            k for k in runtime.client.completions.kwargs if k.get("stream")
        ]
        assert len(redacciones) == 2
        assert redacciones[0]["reasoning_effort"] == "high"
        assert redacciones[1]["reasoning_effort"] == OPENAI.min_answer_effort

    @pytest.mark.asyncio
    async def test_no_se_reintenta_si_la_primera_pasada_escribio_algo(self, servicio):
        runtime = _Runtime(
            _Cliente(tandas=[["Ya vale."], ["No debería llegar aquí."]]),
            effort="alto",
        )

        eventos = await _recoger(servicio, runtime)

        tokens = [e for e in eventos if e.startswith("event: token")]
        assert len(tokens) == 1
        assert "Ya vale." in tokens[0]
        redacciones = [
            k for k in runtime.client.completions.kwargs if k.get("stream")
        ]
        assert len(redacciones) == 1

    @pytest.mark.asyncio
    async def test_sin_razonamiento_no_hay_segunda_pasada(self, servicio):
        """Sin `reasoning_effort` el reintento no cambiaría nada: no se hace."""
        runtime = _Runtime(_Cliente(tandas=[[], ["Rescatado."]]))

        await _recoger(servicio, runtime)

        redacciones = [
            k for k in runtime.client.completions.kwargs if k.get("stream")
        ]
        assert len(redacciones) == 1


class TestTopeDeTokensDeLaRedaccion:
    @pytest.mark.asyncio
    async def test_el_pensamiento_no_se_come_el_tope_de_la_respuesta(self, servicio):
        """
        El modo "comentario" quiere 900 tokens de TEXTO. Con esfuerzo alto el
        tope que se manda tiene que ser mayor, o el modelo se queda sin sitio
        para escribir después de pensar.
        """
        runtime = _Runtime(_Cliente(textos=["Hola."]), effort="alto")

        await _recoger(servicio, runtime)

        redaccion = next(
            k for k in runtime.client.completions.kwargs if k.get("stream")
        )
        assert redaccion["max_completion_tokens"] > 900

    @pytest.mark.asyncio
    async def test_sin_razonar_el_tope_es_el_del_modo(self, servicio):
        runtime = _Runtime(_Cliente(textos=["Hola."]), effort="ninguno")

        await _recoger(servicio, runtime)

        redaccion = next(
            k for k in runtime.client.completions.kwargs if k.get("stream")
        )
        assert redaccion["max_completion_tokens"] == 900


# ─── La caché de herramientas ────────────────────────────────────


class TestLaCacheNoGuardaAverias:
    """
    La caché por petición existe porque cada scrape cuesta ~20 s y el modelo
    reabre el mismo documento en rondas distintas. Pero guardaba también las
    AVERÍAS, y eso tiene un efecto perverso: el modelo reintenta la fuente que
    falló —justo lo que se le pide que haga— y recibe el mismo error al
    instante, sin que nadie lo haya vuelto a intentar. Se rendía a la primera
    creyendo que lo había intentado dos veces.
    """

    @pytest.fixture()
    def servicio_con_tools(self, servicio):
        servicio.tools = [
            {
                "type": "function",
                "function": {"name": "leer_pasaje_biblico", "parameters": {}},
            }
        ]
        return servicio

    @pytest.mark.asyncio
    async def test_una_averia_se_vuelve_a_intentar(
        self, servicio_con_tools, monkeypatch
    ):
        intentos: List[str] = []

        async def revienta(self, name, args, config=None):
            intentos.append(name)
            return json.dumps({"error": TOOL_FAILED})

        monkeypatch.setattr(ChatService, "_run_tool", revienta)
        # El modelo pide LA MISMA herramienta con los mismos argumentos en dos
        # rondas: misma clave de caché.
        runtime = _Runtime(
            _Cliente(rondas=[["leer_pasaje_biblico"], ["leer_pasaje_biblico"]])
        )

        await _recoger(servicio_con_tools, runtime)

        assert len(intentos) == 2

    @pytest.mark.asyncio
    async def test_un_resultado_bueno_si_se_cachea(
        self, servicio_con_tools, monkeypatch
    ):
        intentos: List[str] = []

        async def responde(self, name, args, config=None):
            intentos.append(name)
            return json.dumps({"titulo": "Hechos 20:26, 27"})

        monkeypatch.setattr(ChatService, "_run_tool", responde)
        runtime = _Runtime(
            _Cliente(rondas=[["leer_pasaje_biblico"], ["leer_pasaje_biblico"]])
        )

        await _recoger(servicio_con_tools, runtime)

        # Un scrape, no dos: para esto está la caché.
        assert len(intentos) == 1

    @pytest.mark.asyncio
    async def test_un_error_legitimo_de_la_herramienta_si_se_cachea(
        self, servicio_con_tools, monkeypatch
    ):
        """"No encontrado" es determinista: volver a preguntar da lo mismo."""
        intentos: List[str] = []

        async def no_encontrado(self, name, args, config=None):
            intentos.append(name)
            return json.dumps({"error": "no encontrado"})

        monkeypatch.setattr(ChatService, "_run_tool", no_encontrado)
        runtime = _Runtime(
            _Cliente(rondas=[["leer_pasaje_biblico"], ["leer_pasaje_biblico"]])
        )

        await _recoger(servicio_con_tools, runtime)

        assert len(intentos) == 1


class TestToolFailed:
    def test_reconoce_la_averia(self):
        assert tool_failed(json.dumps({"error": TOOL_FAILED}))

    def test_no_confunde_un_error_de_la_herramienta_con_una_averia(self):
        assert not tool_failed(json.dumps({"error": "no encontrado"}))

    def test_un_resultado_bueno_no_es_averia(self):
        assert not tool_failed(json.dumps({"titulo": "Isaías 58"}))

    @pytest.mark.parametrize("basura", ["", "no soy json", "[]", "null"])
    def test_lo_que_no_parsea_no_se_da_por_averia(self, basura):
        # Ante la duda, se cachea: es el comportamiento de antes.
        assert not tool_failed(basura)


class TestElRecordatorioDeRedactar:
    """
    Sin un mensaje de cierre, el último que ve el modelo es un `role: tool` y la
    petición va SIN `tools`. Con OpenAI da igual; con Gemini es un turno que
    acaba en `functionResponse` sin `functionDeclarations` y devuelve un
    candidato sin partes: stream vacío, sin error. La investigación profunda
    nunca tuvo el problema porque siempre metió su `_SYNTHESIS_SYSTEM` antes de
    redactar.
    """

    @pytest.fixture()
    def servicio_con_tools(self, servicio):
        servicio.tools = [
            {
                "type": "function",
                "function": {"name": "leer_pasaje_biblico", "parameters": {}},
            }
        ]
        return servicio

    @pytest.mark.asyncio
    async def test_tras_investigar_se_le_dice_que_redacte(
        self, servicio_con_tools, monkeypatch
    ):
        async def responde(self, name, args, config=None):
            return json.dumps({"titulo": "Hechos 20:26, 27"})

        monkeypatch.setattr(ChatService, "_run_tool", responde)
        runtime = _Runtime(_Cliente(rondas=[["leer_pasaje_biblico"]]))

        await _recoger(servicio_con_tools, runtime)

        redaccion = next(
            k for k in runtime.client.completions.kwargs if k.get("stream")
        )
        ultimo = redaccion["messages"][-1]
        assert ultimo["role"] == "system"
        assert "Redacta AHORA" in ultimo["content"]

    @pytest.mark.asyncio
    async def test_sin_investigar_no_se_le_recuerda_nada(self, servicio):
        # No hubo ronda de herramientas: el historial no acaba en un `tool` y el
        # recordatorio solo sería ruido en el contexto.
        runtime = _Runtime(_Cliente(textos=["Hola."]))

        await _recoger(servicio, runtime)

        redaccion = next(
            k for k in runtime.client.completions.kwargs if k.get("stream")
        )
        assert redaccion["messages"][-1]["role"] == "user"
