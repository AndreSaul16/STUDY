"""Tests del parser del texto del día (sin llamadas de red)."""

from pathlib import Path

import pytest

from app.services.jw import DailyText, DailyTextError, parse_daily_text

FIXTURE = Path(__file__).parent / "fixtures" / "wol_daily_text_es.html"
SOURCE_URL = "https://wol.jw.org/es/wol/dt/r4/lp-s/2026/7/21"


@pytest.fixture
def fixture_html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def test_parse_extracts_theme_and_body(fixture_html: str):
    result = parse_daily_text(fixture_html, SOURCE_URL)

    assert isinstance(result, DailyText)
    # Versículo tema no vacío y con la cita.
    assert result.theme_text
    assert "hombres como regalos" in result.theme_text
    assert result.theme_scripture_ref == "Efes. 4:8"

    # Comentario no vacío y con el texto esperado.
    assert result.body
    assert "hombres como regalos" in result.body

    # Fecha legible con "julio".
    assert "julio" in result.date_label
    assert result.date_iso == "2026-07-21"
    assert result.source_url == SOURCE_URL


def test_parse_ignores_non_daily_text_blocks(fixture_html: str):
    """El comentario no debe contaminarse con la guía de reuniones (pub-mwb)."""
    result = parse_daily_text(fixture_html, SOURCE_URL)
    assert "TESOROS DE LA BIBLIA" not in result.body
    assert "Estudio bíblico de la congregación" not in result.body


def test_parse_raises_on_garbage_html():
    with pytest.raises(DailyTextError):
        parse_daily_text("<html><body>nada</body></html>", SOURCE_URL)
