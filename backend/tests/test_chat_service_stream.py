"""
Tests del stream SSE de ``ChatService.chat_stream``. Sin red y sin keys.

Cubren el **contrato del stream**, que es lo que rompe al cliente sin que nadie
se entere en el servidor:

  - todo turno termina con un ``done``, también cuando falla. Sin él, el
    consumidor se queda esperando un final que no llega y el composer no vuelve;
  - el ``metadata`` sale siempre, con herramientas o sin ellas: es lo que se
    persiste con el mensaje y lo que pinta el pie "modelo · esfuerzo".
"""

from typing import Any, Dict, List

import pytest

from app.services.ai.chat_service import ChatService


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

    async def create(self, **kwargs):
        if self._revienta:
            raise RuntimeError("el proveedor dice que no")
        if kwargs.get("stream"):
            return _Stream(self._textos)
        return _Respuesta("")


class _Cliente:
    def __init__(self, **kwargs):
        self.chat = type("Chat", (), {"completions": _Completions(**kwargs)})()


class _Runtime:
    """Lo justo de ``ChatRuntime`` que usa ``chat_stream``."""

    def __init__(self, client):
        self.client = client
        self.model = "modelo-de-prueba"
        self.tool_params: Dict[str, Any] = {}
        self.answer_params: Dict[str, Any] = {}

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
