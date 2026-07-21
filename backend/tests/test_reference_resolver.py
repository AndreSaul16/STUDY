"""Tests del resolutor de referencias (mapa de libros y parser WOL español)."""

from pathlib import Path

import pytest

from app.services.jw.book_numbers import book_display_name, book_number
from app.services.references.reference_resolver import (
    ReferenceResolutionError,
    _parse_identifier,
    _parse_wol_spanish,
)

FIXTURE = Path(__file__).parent / "fixtures" / "wol_bible_es_eph4.html"


@pytest.fixture
def eph4_html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


# ─── Mapa de libros ──────────────────────────────────────────────
def test_book_number_basic():
    assert book_number("efesios") == 49
    assert book_number("Efesios") == 49
    assert book_number("génesis") == 1
    assert book_number("genesis") == 1  # sin tilde


def test_book_number_numbered_and_variants():
    assert book_number("2 corintios") == 47
    assert book_number("1 timoteo") == 54
    assert book_number("salmo") == 19
    assert book_number("Salmos") == 19
    assert book_number("números") == 4


def test_book_number_unknown():
    assert book_number("noexiste") is None
    assert book_number("") is None


def test_book_display_name():
    assert book_display_name(49) == "Efesios"


# ─── Identificador ───────────────────────────────────────────────
def test_parse_identifier_ok():
    assert _parse_identifier("scripture:efesios:4:15") == ("efesios", 4, "15")
    assert _parse_identifier("scripture:salmo:23:all") == ("salmo", 23, "all")


def test_parse_identifier_invalid():
    with pytest.raises(ReferenceResolutionError):
        _parse_identifier("publication:atalaya:2023:7")
    with pytest.raises(ReferenceResolutionError):
        _parse_identifier("scripture:efesios:x:15")


# ─── Parser WOL español (sin red) ────────────────────────────────
def test_parse_single_verse(eph4_html: str):
    text = _parse_wol_spanish(eph4_html, 49, 4, "15")
    assert "diciendo la verdad" in text
    assert "Cristo" in text
    # No debe arrastrar el nº de versículo ni marcadores "+".
    assert not text.startswith("15")
    assert "+" not in text


def test_parse_verse_1_strips_chapter_number(eph4_html: str):
    text = _parse_wol_spanish(eph4_html, 49, 4, "1")
    assert text.startswith("Así que yo")


def test_parse_all_verses(eph4_html: str):
    text = _parse_wol_spanish(eph4_html, 49, 4, "all")
    assert text.startswith("1 ")
    assert "2 " in text
    assert len(text) > 500


def test_parse_missing_verse_returns_empty(eph4_html: str):
    # Capítulo inexistente en el fixture → cadena vacía (dispara fallback).
    assert _parse_wol_spanish(eph4_html, 49, 99, "1") == ""
