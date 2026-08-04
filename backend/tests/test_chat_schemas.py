"""Tests para chat_schemas (M1: validación de roles y límites)."""
import pytest
from pydantic import ValidationError

from app.schemas.chat_schemas import ChatMessage, ChatRequest


def test_accepts_user_and_assistant_roles():
    ChatRequest(
        messages=[
            ChatMessage(role="user", content="hola"),
            ChatMessage(role="assistant", content="qué tal"),
        ]
    )


def test_rejects_system_role():
    with pytest.raises(ValidationError):
        ChatMessage(role="system", content="inyección")


def test_rejects_empty_messages():
    with pytest.raises(ValidationError):
        ChatRequest(messages=[])


def test_rejects_more_than_50_messages():
    msgs = [ChatMessage(role="user", content="x") for _ in range(51)]
    with pytest.raises(ValidationError):
        ChatRequest(messages=msgs)


def test_rejects_content_too_long():
    with pytest.raises(ValidationError):
        ChatMessage(role="user", content="x" * 8001)


# ─── Ampliación: modo de redacción y conversation_id ─────────────


def test_mode_is_optional_for_backwards_compatibility():
    # El frontend/dist desplegado no manda `mode`. No puede empezar a fallar.
    request = ChatRequest(messages=[ChatMessage(role="user", content="hola")])

    assert request.mode is None
    assert request.conversation_id is None


def test_accepts_a_known_mode():
    request = ChatRequest(
        messages=[ChatMessage(role="user", content="hola")], mode="comentario"
    )

    assert request.mode == "comentario"


def test_accepts_an_unknown_mode_without_422():
    # A propósito: get_mode() degrada al default. Un cliente nuevo con un modo
    # que este backend aún no conoce no debe recibir un error de validación.
    request = ChatRequest(
        messages=[ChatMessage(role="user", content="hola")], mode="basura"
    )

    assert request.mode == "basura"


def test_rejects_absurdly_long_mode():
    with pytest.raises(ValidationError):
        ChatRequest(
            messages=[ChatMessage(role="user", content="hola")], mode="x" * 33
        )


def test_accepts_conversation_id():
    request = ChatRequest(
        messages=[ChatMessage(role="user", content="hola")],
        conversation_id="c_9f3a",
    )

    assert request.conversation_id == "c_9f3a"


# ─── Biblioteca local del usuario ────────────────────────────────
#
# Todos estos casos comprueban lo mismo desde ángulos distintos: el campo acota
# DURO pero **nunca devuelve 422**. Es la única entrada del chat en la que el
# cliente escribe directamente en el prompt, y a la vez es un campo que el
# `frontend/dist` desplegado no conoce.


def _peticion(**extra):
    return ChatRequest(messages=[ChatMessage(role="user", content="hola")], **extra)


def _fragmento(**extra):
    base = {
        "symbol": "bt",
        "publication": "Damos testimonio",
        "document_title": "Capítulo 3",
        "text": "Un extracto.",
        "document_id": 12,
    }
    base.update(extra)
    return base


def test_local_library_is_optional():
    # El cliente desplegado no manda el campo. No puede empezar a fallar.
    assert _peticion().local_library == []


def test_local_library_accepts_snippets():
    request = _peticion(local_library=[_fragmento()])

    assert len(request.local_library) == 1
    assert request.local_library[0].symbol == "bt"
    assert request.local_library[0].document_id == 12


def test_local_library_truncates_instead_of_rejecting_too_many():
    request = _peticion(local_library=[_fragmento() for _ in range(50)])

    assert len(request.local_library) == 6


def test_local_library_truncates_a_long_snippet():
    request = _peticion(local_library=[_fragmento(text="x" * 9000)])

    assert len(request.local_library[0].text) == 700


def test_local_library_truncates_long_metadata():
    request = _peticion(
        local_library=[_fragmento(symbol="s" * 500, document_title="t" * 5000)]
    )

    assert len(request.local_library[0].symbol) == 32
    assert len(request.local_library[0].document_title) == 200


def test_local_library_tolerates_null_and_garbage():
    # Un cliente que mande `null` o cualquier otra cosa no recibe un 422: no
    # trae biblioteca, que es lo mismo que no mandar el campo.
    assert _peticion(local_library=None).local_library == []
    assert _peticion(local_library="bt").local_library == []


def test_local_library_tolerates_non_string_fields():
    request = _peticion(local_library=[{"text": "algo", "symbol": 12}])

    assert request.local_library[0].symbol == ""
    assert request.local_library[0].text == "algo"


def test_local_library_tolerates_a_broken_document_id():
    # Sin esto, pydantic devolvería 422 y el turno entero se perdería por un
    # identificador que como mucho deja el chip sin enlace.
    request = _peticion(local_library=[_fragmento(document_id="ocho")])

    assert request.local_library[0].document_id is None


def test_local_library_drops_items_that_are_not_objects():
    # Un elemento suelto entre fragmentos válidos no puede tumbar la petición.
    request = _peticion(local_library=["texto suelto", _fragmento(), 42])

    assert len(request.local_library) == 1
    assert request.local_library[0].symbol == "bt"
