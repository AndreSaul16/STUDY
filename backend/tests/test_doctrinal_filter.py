"""
Tests del filtro doctrinal.

Tres cosas que no pueden fallar en silencio:

  1. Que lo apóstata se BLOQUEE, no se marque. Un modelo con el texto delante y
     la orden de no usarlo acaba filtrándolo en el razonamiento.
  2. Que un dato científico normal NO se marque. Si todo pide contraste, el
     aviso deja de significar nada y el agente lo ignora.
  3. Que un punto de vista distinto NO se bloquee. Solo se descarta la
     apostasía; discrepar no es atacar, y una investigación que solo lee lo
     que ya sabe no es una investigación.

Funciones puras: sin red, sin API key.
"""

import pytest

from app.services.ai import doctrinal_filter as df


class TestBloqueoPorDominio:
    @pytest.mark.parametrize(
        "url",
        [
            "https://jwfacts.com/watchtower/algo.php",
            "https://www.jwfacts.com/x",
            "https://foro.jwfacts.com/x",  # subdominio
            "https://avoidjw.org/es/",
            "https://carm.org/jehovahs-witnesses/",
            "https://www.reddit.com/r/exjw/comments/1abc/",
        ],
    )
    def test_dominios_y_rutas_de_oposicion(self, url):
        assert df.inspect("Un título neutro", "Un resumen neutro", url).blocked

    @pytest.mark.parametrize(
        "url",
        [
            "https://nature.com/articles/x",
            "https://www.reddit.com/r/biology/comments/1abc/",
            "https://wol.jw.org/es/wol/d/r4/lp-s/123",
            "",
        ],
    )
    def test_no_bloquea_lo_legitimo(self, url):
        assert not df.inspect("Estudio sobre pingüinos", "resumen", url).blocked

    def test_el_entorno_amplia_la_lista(self, monkeypatch):
        url = "https://sitio-nuevo.example/x"
        assert not df.inspect("t", "s", url).blocked

        monkeypatch.setenv("RESEARCH_BLOCKED_DOMAINS", "sitio-nuevo.example, otro.com")
        assert df.inspect("t", "s", url).blocked


class TestBloqueoPorSenal:
    @pytest.mark.parametrize(
        "texto",
        [
            "testimonio de un ex-testigo de Jehová",
            "former Jehovah's Witness speaks out",
            "Leaving the Watchtower behind",
            "por qué es una secta de los testigos",
        ],
    )
    def test_el_contenido_delata_aunque_el_dominio_sea_desconocido(self, texto):
        assert df.inspect("Mi historia", texto, "https://blog.example/x").blocked

    def test_los_acentos_no_salvan_la_senal(self):
        # "apostata" y "apóstata" tienen que dar lo mismo.
        assert df.inspect("Análisis apóstata", "", "https://x.example").blocked

    def test_el_bloqueo_gana_al_contraste(self):
        # Un sitio de oposición que además habla de evolución NO es "para
        # contrastar": es para no leer.
        verdict = df.inspect(
            "Evolution and the Watchtower", "darwin", "https://jwfacts.com/x"
        )
        assert verdict.action == df.BLOCK


class TestContraste:
    @pytest.mark.parametrize(
        "titulo,tema",
        [
            ("Human evolution and natural selection", "origenes"),
            ("Evidence for the immortal soul", "alma"),
            ("The doctrine of the Trinity explained", "trinidad"),
            ("Blood transfusion outcomes in surgery", "sangre"),
            ("Astrología y personalidad", "espiritismo"),
        ],
    )
    def test_marca_los_temas_que_chocan(self, titulo, tema):
        verdict = df.inspect(titulo, "", "https://nature.com/x")

        assert verdict.needs_counter
        assert tema in verdict.topics

    @pytest.mark.parametrize(
        "titulo",
        [
            "Thermoregulation in fasting emperor penguins",
            "Structural analysis of spider silk",
            "How the Roman aqueducts were built",
        ],
    )
    def test_un_dato_cientifico_normal_no_pide_contraste(self, titulo):
        # Si todo se marca, el aviso deja de significar algo.
        assert df.inspect(titulo, "", "https://science.org/x").action == df.ALLOW

    def test_la_nota_no_prohibe_usarlo(self):
        # Otro punto de vista es información, no contaminación. La redacción
        # prohibitiva anterior hacía que el modelo descartara de plano fuentes
        # útiles en cuanto aparecía la palabra "evolución".
        nota = df.counter_note(("origenes",))

        assert "OTRO PUNTO DE VISTA" in nota
        assert "Puedes usarla" in nota
        # Pero sí pide poner al lado lo que enseña la Biblia.
        assert "creación" in nota

    def test_la_directiva_de_turno_lista_los_temas_sin_repetir(self):
        directiva = df.counter_directive(["origenes", "alma", "origenes"])

        assert "no hace falta que lo evites" in directiva
        assert directiva.count("origen de la vida") == 1
        assert "alma" in directiva

    def test_sin_temas_no_hay_nota_ni_directiva(self):
        assert df.counter_note(()) == ""
        assert df.counter_directive([]) == ""
        assert df.counter_note(("tema_que_no_existe",)) == ""


class TestFilterResults:
    def _resultados(self):
        return [
            {"titulo": "Penguins", "resumen": "cold", "url": "https://nature.com/a"},
            {"titulo": "Evolution of birds", "resumen": "darwin", "url": "https://science.org/b"},
            {"titulo": "La verdad", "resumen": "apostata", "url": "https://blog.example/c"},
        ]

    def test_bloquea_cuenta_y_marca(self):
        vivos, temas, bloqueados = df.filter_results(self._resultados())

        assert [r["titulo"] for r in vivos] == ["Penguins", "Evolution of birds"]
        assert bloqueados == 1
        assert temas == ["origenes"]
        assert "aviso_doctrinal" not in vivos[0]
        assert "aviso_doctrinal" in vivos[1]

    def test_aguanta_basura_en_la_lista(self):
        vivos, _, _ = df.filter_results([None, "texto suelto", 42, {"titulo": "ok"}])

        assert [r["titulo"] for r in vivos] == ["ok"]

    def test_lee_tambien_las_claves_en_ingles(self):
        # Los catálogos externos devuelven `title`/`snippet` en algunos casos.
        vivos, _, bloqueados = df.filter_results(
            [{"title": "x", "snippet": "y", "url": "https://jwfacts.com/z"}]
        )

        assert vivos == []
        assert bloqueados == 1
