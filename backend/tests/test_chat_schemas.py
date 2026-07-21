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
