"""
Tests del stream SSE de ``ChatService.chat_stream``. Sin red y sin keys.

Cubren el **contrato del stream**, que es lo que rompe al cliente sin que nadie
se entere en el servidor:

  - todo turno termina con un ``done``, también cuando falla. Sin él, el
    consumidor se queda esperando un final que no llega y el composer no vuelve;
  - el ``metadata`` sale siempre, con herramientas o sin ellas: es lo que se
    persiste con el mensaje y lo que pinta el pie "modelo · esfuerzo".
"""

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from app.services.ai.chat_service import ChatService
from app.services.ai.local_library import from_payload


# ─── Dobles ──────────────────────────────────────────────────────


class _Delta:
    def __init__(self, content: str | None):
        self.content = content


class _Choice:
    def __init__(self, content: str | None):
        self.delta = _Delta(content)


class _Chunk:
    def __init__(self, content: str | None):
        self.choices = [_Choice(content)]
        self.usage = None


class _Mensaje:
    def __init__(self, content: str | None = "", tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []


class _Respuesta:
    def __init__(self, content: str = ""):
        self.choices = [type("C", (), {"message": _Mensaje(content)})()]
        self.usage = None


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
    def __init__(self, *, revienta: bool = False, textos: List[str] | None = None):
        self._revienta = revienta
        self._textos = textos if textos is not None else ["Hola."]
        #: Los `messages` de cada llamada. Es la única forma de comprobar qué
        #: se le puso delante al modelo sin salir a la red.
        self.llamadas: List[List[Dict[str, Any]]] = []

    async def create(self, **kwargs):
        self.llamadas.append(list(kwargs.get("messages") or []))
        if self._revienta:
            raise RuntimeError("el proveedor dice que no")
        if kwargs.get("stream"):
            return _Stream(self._textos)
        return _Respuesta("")


class _Cliente:
    def __init__(self, **kwargs):
        self.completions = _Completions(**kwargs)
        self.chat = type("Chat", (), {"completions": self.completions})()


class _Runtime:
    """Lo justo de ``ChatRuntime`` que usa ``chat_stream``."""

    def __init__(self, client, inline_reasoning: bool = False):
        self.client = client
        self.model = "modelo-de-prueba"
        self.tool_params: Dict[str, Any] = {}
        self.answer_params: Dict[str, Any] = {}
        # `chat_stream` mira `provider.inline_reasoning` para saber si tiene
        # que limpiar los bloques <think> del stream (MiniMax los emite).
        self.provider = SimpleNamespace(
            id="openai", inline_reasoning=inline_reasoning
        )

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
