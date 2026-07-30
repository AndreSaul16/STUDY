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
