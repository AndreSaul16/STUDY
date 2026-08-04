"""
Tests de la extracción de fechas de publicación.

Lo que se blinda aquí son los FALSOS POSITIVOS, que es lo que rompió la primera
versión: rastrear años sueltos en texto libre fechaba el índice
"…Watch Tower 1986-2026" en 2026 y el vídeo "En 1914 el mundo cambió de rumbo"
en 1914. Una fecha inventada es peor que ninguna, porque tira del filtro justo
la fuente buena y llena de avisos falsos lo que sí está vigente.

Sin red y sin reloj real: el año de referencia se inyecta.
"""

import pytest

from app.services.jw import pub_dates

REF = 2026


class TestSimbolos:
    @pytest.mark.parametrize(
        "simbolo,esperado",
        [
            ("w06", 2006),
            ("W06", 2006),
            ("g19", 2019),
            ("wp17", 2017),
            ("mwb24", 2024),
            ("w20.06", 2020),
            ("ws16", 2016),
            ("km95", 1995),
            ("w50", 1950),
        ],
    )
    def test_saca_el_ano_del_simbolo(self, simbolo, esperado):
        assert pub_dates.year_from_symbol(simbolo, reference=REF) == esperado

    def test_el_ano_de_dos_cifras_no_se_va_al_futuro(self):
        # "95" con 2026 de referencia es 1995, no 2095.
        assert pub_dates.year_from_symbol("w95", reference=REF) == 1995

    @pytest.mark.parametrize("simbolo", ["it-1", "it", "nwt", "cf", "od", "", "sjj"])
    def test_los_libros_sin_ano_devuelven_none(self, simbolo):
        # Perspicacia volumen 1 ("it-1") NO es del año 2001. Y los libros sin
        # año no caducan, así que no deben recibir aviso de antigüedad.
        assert pub_dates.year_from_symbol(simbolo, reference=REF) is None


class TestCitas:
    def test_cita_completa_de_wol(self):
        cita = "w06 1/12 págs. 25-29 - La Atalaya 2006"
        assert pub_dates.year_from_citation(cita, reference=REF) == 2006

    def test_cita_con_mes_en_letra(self):
        cita = "w16 abril págs. 13-17 - La Atalaya (estudio) 2016"
        assert pub_dates.year_from_citation(cita, reference=REF) == 2016

    def test_cita_de_libro_sin_ano(self):
        cita = "it-1 “Aguante” - Perspicacia, volumen 1"
        assert pub_dates.year_from_citation(cita, reference=REF) is None

    def test_cita_vacia(self):
        assert pub_dates.year_from_citation("", reference=REF) is None
        assert pub_dates.year_from_citation(None, reference=REF) is None


class TestNoInventaFechas:
    """El motivo por el que existe este módulo separado del regex de años."""

    def test_un_titulo_con_un_ano_dentro_no_es_una_fecha_de_publicacion(self):
        # Vídeo real de jw.org. 1914 es el TEMA, no cuándo se publicó.
        assert pub_dates.parse_year("En 1914 el mundo cambió de rumbo") is None

    def test_el_rango_de_cobertura_de_un_indice_no_es_su_fecha(self):
        contexto = "Índice de las publicaciones Watch Tower 1986-2026"
        assert pub_dates.parse_year(contexto) is None

    def test_un_lank_sin_ano_mes_no_da_ano(self):
        assert pub_dates.parse_year("pub-osg_56_VIDEO") is None


class TestSenalesEstructuradas:
    def test_fecha_iso_del_mediator(self):
        assert pub_dates.parse_year("2018-03-26T17:15:20.035Z") == 2018

    def test_lank_de_broadcasting_con_ano_mes(self):
        assert pub_dates.parse_year("pub-jwbcov_201705_15_VIDEO") == 2017

    def test_el_mes_valida_el_bloque(self):
        # "_201799_" no es un año-mes: el 99 no es un mes válido.
        assert pub_dates.year_from_lank("pub-x_201799_1_VIDEO") is None

    def test_el_primer_candidato_que_da_ano_gana(self):
        assert pub_dates.parse_year("", "w06", "2018-01-01") == 2006


class TestRangos:
    @pytest.mark.parametrize(
        "ano,desde,hasta,entra",
        [
            (2010, None, None, True),
            (2010, 2005, None, True),
            (2010, 2015, None, False),
            (2010, None, 2005, False),
            (2010, 2005, 2015, True),
            (None, 2015, 2020, True),  # sin fecha SIEMPRE pasa
        ],
    )
    def test_within_range(self, ano, desde, hasta, entra):
        assert pub_dates.within_range(ano, desde, hasta) is entra

    def test_lo_no_fechable_nunca_se_descarta(self):
        # Perspicacia y los libros no llevan año. Un filtro que los tirase
        # dejaría fuera justo las obras de referencia.
        items = [{"anio": 1990}, {"anio": None}, {"anio": 2020}]
        assert pub_dates.filter_by_years(items, since=2015) == [
            {"anio": None},
            {"anio": 2020},
        ]


class TestAvisos:
    def test_una_publicacion_vieja_lleva_aviso(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_STALE_AFTER_YEARS", "25")
        assert pub_dates.is_stale(1990, reference=REF) is True
        assert "más reciente" in pub_dates.freshness_note(1990, reference=REF)

    def test_una_reciente_no_lleva_aviso(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_STALE_AFTER_YEARS", "25")
        assert pub_dates.is_stale(2020, reference=REF) is False
        assert pub_dates.freshness_note(2020, reference=REF) == ""

    def test_sin_fecha_avisa_de_que_no_hay_fecha(self):
        # No es lo mismo "es viejo" que "no sé de cuándo es". El segundo aviso
        # pide comprobarlo, no descartarlo.
        assert "Sin fecha" in pub_dates.freshness_note(None)

    def test_el_umbral_malformado_degrada_al_default(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_STALE_AFTER_YEARS", "muchos")
        assert pub_dates.stale_after_years() == 25


class TestClampYear:
    @pytest.mark.parametrize(
        "entrada,esperado",
        [("2010", 2010), (2010, 2010), (None, None), ("", None), ("ayer", None)],
    )
    def test_normaliza_lo_que_manda_el_modelo(self, entrada, esperado):
        assert pub_dates.clamp_year(entrada) == esperado

    def test_rechaza_anos_imposibles(self):
        assert pub_dates.clamp_year(1200) is None
        assert pub_dates.clamp_year(3000) is None


class TestAnnotate:
    def test_anade_ano_y_aviso(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_STALE_AFTER_YEARS", "25")
        payload = pub_dates.annotate({"titulo": "x"}, "w90", reference=REF)

        assert payload["anio"] == 1990
        assert "aviso_fecha" in payload

    def test_sin_aviso_cuando_es_reciente(self, monkeypatch):
        monkeypatch.setenv("RESEARCH_STALE_AFTER_YEARS", "25")
        payload = pub_dates.annotate({"titulo": "x"}, "w24", reference=REF)

        assert payload["anio"] == 2024
        assert "aviso_fecha" not in payload
