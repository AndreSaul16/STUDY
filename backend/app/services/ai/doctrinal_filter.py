"""
Filtro doctrinal — qué se descarta, qué se contrasta y qué pasa tal cual.

Este módulo solo actúa sobre **material de fuera de jw.org**. Todo lo que viene
de wol.jw.org o jw.org pasa sin tocarse: es la fuente de referencia de la app,
no algo que haya que auditar.

Tres veredictos, y el orden importa:

  ``bloqueado``  Solo apostasía y oposición: sitios dedicados a atacar las
                 creencias o la organización. No llega al modelo, ni resumido.
                 Un modelo con el texto delante y la orden de "no usarlo" acaba
                 filtrándolo en el razonamiento; la única defensa fiable es que
                 no lo lea. Esta es la única categoría que se descarta.

  ``contrastar`` Material legítimo —un paper, una enciclopedia— que sostiene
                 un punto de vista distinto al de la Biblia. **No se descarta y
                 no se prohíbe.** Conocer otras posturas es parte de investigar,
                 y a veces son justo lo que hace falta para responderlas o para
                 ilustrar un punto. Se marca, nada más: el agente decide si lo
                 usa, y si lo usa, escribe también qué enseña la Biblia para que
                 el lector no se quede con media historia.

  ``permitido``  Lo demás.

La diferencia entre las dos primeras es deliberada y no es de grado: una es
material hostil, la otra es desacuerdo honesto. Meterlas en el mismo saco
convertiría la investigación en una cámara de eco.

**Esto es una heurística, y se comporta como tal.** Un dominio nuevo no está en
la lista, y un artículo puede contradecir la Biblia sin usar ninguna de las
palabras que aquí se buscan. Por eso el filtro no está solo: la búsqueda en
internet parte de una lista blanca de fuentes (ver ``research/web_search.py``),
que es la barrera que de verdad sostiene el sistema. Esto es la segunda.

Funciones puras, sin red y sin estado: la política se testea en una tabla.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterable, Optional
from urllib.parse import urlparse

# ─── Bloqueo duro ────────────────────────────────────────────────

#: Dominios de sitios dedicados a atacar las creencias o la organización de los
#: testigos de Jehová. La lista es SEMILLA, no un censo: se amplía por entorno
#: con ``RESEARCH_BLOCKED_DOMAINS`` (separados por comas). Un dominio que no
#: esté aquí puede colarse; para eso está la lista blanca de la búsqueda.
_SEED_BLOCKED_DOMAINS = frozenset(
    {
        "jwfacts.com",
        "avoidjw.org",
        "jwsurvey.org",
        "exjw.org",
        "jwleaks.org",
        "watchtowerdocuments.org",
        "silentlambs.org",
        "jehovahs-witness.com",
        "jwstruggle.com",
        "4witness.org",
        "carm.org",
        "equip.org",
        "letusreason.org",
        "forananswer.org",
        "bible.ca",
        "culteducation.com",
        "rickross.com",
    }
)

#: Rutas de sitios generalistas dedicadas al mismo asunto. Bloquear
#: ``reddit.com`` entero sería absurdo; ``reddit.com/r/exjw`` no.
_BLOCKED_PATHS = (
    "/r/exjw",
    "/r/exjw/",
    "/exjehovahswitnesses",
)

#: Señales en el título o el fragmento. Van en minúsculas y sin acentos
#: relevantes; se comparan sobre el texto normalizado.
_BLOCKED_SIGNALS = (
    "ex-testigo de jehova",
    "ex testigo de jehova",
    "extestigo de jehova",
    "ex-jehovah's witness",
    "ex-jehovahs witness",
    "former jehovah's witness",
    "former jehovahs witness",
    "apostata",
    "apostate",
    "exjw",
    "leaving the watchtower",
    "dejar la organizacion",
    "salir de la organizacion",
    "secta de los testigos",
    "watchtower cult",
    "jw cult",
    "culto de los testigos",
    "profecias fallidas de la watchtower",
    "failed prophecies of the watchtower",
)


def _extra_blocked_domains() -> frozenset[str]:
    raw = os.getenv("RESEARCH_BLOCKED_DOMAINS", "")
    return frozenset(
        d.strip().lower().lstrip(".") for d in raw.split(",") if d.strip()
    )


def blocked_domains() -> frozenset[str]:
    """Semilla + lo que añada el entorno. Se lee en cada llamada a propósito."""
    return _SEED_BLOCKED_DOMAINS | _extra_blocked_domains()


# ─── Temas que exigen contraste bíblico ──────────────────────────


@dataclass(frozen=True)
class ConflictTopic:
    """Un tema donde el material externo suele chocar con la Biblia."""

    id: str
    label: str
    #: Palabras que delatan el tema en el título o el resumen.
    signals: tuple[str, ...]
    #: Qué tiene que buscar el agente en las publicaciones para poder responder.
    research: str


CONFLICT_TOPICS: tuple[ConflictTopic, ...] = (
    ConflictTopic(
        id="origenes",
        label="origen de la vida y evolución",
        signals=(
            "evolucion",
            "evolution",
            "darwin",
            "natural selection",
            "seleccion natural",
            "abiogenesis",
            "origin of life",
            "ancestro comun",
            "common ancestor",
            "hominid",
            "homo sapiens evolution",
        ),
        research="qué enseña la Biblia sobre la creación y el diseño",
    ),
    ConflictTopic(
        id="edad_tierra",
        label="cronología y edad de la Tierra",
        signals=(
            "millones de anos",
            "billions of years",
            "radiometric dating",
            "datacion radiometrica",
            "geologic time",
            "era geologica",
        ),
        research="qué dice Génesis sobre los días de la creación y su duración",
    ),
    ConflictTopic(
        id="alma",
        label="el alma y la muerte",
        signals=(
            "alma inmortal",
            "immortal soul",
            "vida despues de la muerte",
            "afterlife",
            "reencarnacion",
            "reincarnation",
            "near-death experience",
            "experiencia cercana a la muerte",
            "purgatorio",
            "infierno de fuego",
            "eternal torment",
        ),
        research="qué enseña la Biblia sobre el alma, la muerte y la resurrección",
    ),
    ConflictTopic(
        id="trinidad",
        label="la naturaleza de Dios y de Jesús",
        signals=(
            "trinidad",
            "trinity",
            "dios trino",
            "triune god",
            "homoousios",
            "consubstancial",
        ),
        research="qué dice la Biblia sobre Jehová, Jesús y el espíritu santo",
    ),
    ConflictTopic(
        id="critica_biblica",
        label="crítica textual e histórica de la Biblia",
        signals=(
            "documentary hypothesis",
            "hipotesis documentaria",
            "pseudoepigraf",
            "mito biblico",
            "biblical myth",
            "the bible is a myth",
            "authorship of isaiah",
            "deutero-isaias",
            "no existio historicamente",
        ),
        research="qué dice la propia Biblia sobre su autoría y su exactitud",
    ),
    ConflictTopic(
        id="sangre",
        label="uso de la sangre",
        signals=(
            "blood transfusion",
            "transfusion de sangre",
            "hemoderivado",
            "transfusion therapy",
        ),
        research="qué enseña la Biblia sobre la santidad de la sangre",
    ),
    ConflictTopic(
        id="espiritismo",
        label="espiritismo, astrología y ocultismo",
        signals=(
            "astrologia",
            "astrology",
            "horoscopo",
            "espiritismo",
            "spiritism",
            "medium espiritista",
            "ouija",
            "tarot",
            "channeling",
        ),
        research="qué dice la Biblia sobre el espiritismo y la adivinación",
    ),
    ConflictTopic(
        id="fiestas",
        label="origen de fiestas y costumbres religiosas",
        signals=(
            "origen pagano",
            "pagan origin",
            "saturnalia",
            "christmas origins",
            "origen de la navidad",
            "easter origins",
        ),
        research="qué principios bíblicos rigen la adoración pura",
    ),
    ConflictTopic(
        id="moral",
        label="normas morales",
        signals=(
            "same-sex marriage",
            "matrimonio homosexual",
            "aborto legal",
            "abortion rights",
            "sexo prematrimonial",
            "premarital sex is",
            "poliamor",
        ),
        research="qué normas da la Biblia sobre ese asunto",
    ),
)


# ─── Normalización ───────────────────────────────────────────────

_ACCENTS = str.maketrans("áàäâéèëêíìïîóòöôúùüûñç", "aaaaeeeeiiiioooouuuunc")
_NON_WORD_RE = re.compile(r"[^a-z0-9']+")


def normalize(text: Optional[str]) -> str:
    """Minúsculas, sin acentos y con los espacios colapsados."""
    lowered = (text or "").lower().translate(_ACCENTS)
    return " ".join(_NON_WORD_RE.sub(" ", lowered).split())


def _host(url: Optional[str]) -> str:
    try:
        host = (urlparse(url or "").hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _domain_blocked(url: Optional[str]) -> bool:
    host = _host(url)
    if not host:
        return False

    denied = blocked_domains()
    if host in denied:
        return True
    # Subdominios: "foro.jwfacts.com" cuenta igual que "jwfacts.com".
    if any(host.endswith(f".{domain}") for domain in denied):
        return True

    path = (urlparse(url or "").path or "").lower()
    return any(path.startswith(blocked) for blocked in _BLOCKED_PATHS)


# ─── Veredicto ───────────────────────────────────────────────────

ALLOW = "permitido"
COUNTER = "contrastar"
BLOCK = "bloqueado"


@dataclass(frozen=True)
class Verdict:
    """Qué hacer con un resultado externo."""

    action: str
    """``permitido`` | ``contrastar`` | ``bloqueado``."""
    reason: str = ""
    topics: tuple[str, ...] = ()
    """Ids de los temas en conflicto detectados."""

    @property
    def blocked(self) -> bool:
        return self.action == BLOCK

    @property
    def needs_counter(self) -> bool:
        return self.action == COUNTER


def inspect(
    title: Optional[str] = None,
    snippet: Optional[str] = None,
    url: Optional[str] = None,
) -> Verdict:
    """
    Clasifica un resultado externo antes de que el modelo lo vea.

    El bloqueo se comprueba primero y corta: un artículo de un sitio de
    oposición que además hable de evolución no es "para contrastar", es para no
    leer.
    """
    if _domain_blocked(url):
        return Verdict(BLOCK, "Fuente de oposición o apostasía.")

    texto = f"{normalize(title)} {normalize(snippet)}"
    if any(signal in texto for signal in _BLOCKED_SIGNALS):
        return Verdict(BLOCK, "El contenido ataca las creencias o la organización.")

    topics = tuple(
        topic.id
        for topic in CONFLICT_TOPICS
        if any(signal in texto for signal in topic.signals)
    )
    if topics:
        return Verdict(
            COUNTER,
            "Toca un tema donde lo publicado fuera suele chocar con la Biblia.",
            topics,
        )

    return Verdict(ALLOW)


def topic_by_id(topic_id: str) -> Optional[ConflictTopic]:
    return next((t for t in CONFLICT_TOPICS if t.id == topic_id), None)


def counter_note(topics: Iterable[str]) -> str:
    """
    Aviso que viaja PEGADO al resultado marcado.

    Va dentro del JSON de la herramienta y no solo en el system prompt: así el
    agente lo tiene delante justo cuando está mirando esa fuente concreta, en
    vez de como una regla general que aplica a ojo tres rondas después.

    El tono es informativo y no prohibitivo a propósito. Una redacción del tipo
    "PROHIBIDO usar esto sin…" hacía que el modelo descartara de plano fuentes
    perfectamente útiles en cuanto la palabra "evolución" aparecía en el
    resumen. Lo que se quiere es que sepa dónde está pisando, no que se asuste.
    """
    etiquetas = []
    deberes = []
    for topic_id in topics:
        topic = topic_by_id(topic_id)
        if topic is None:
            continue
        etiquetas.append(topic.label)
        deberes.append(topic.research)

    if not etiquetas:
        return ""

    return (
        f"OTRO PUNTO DE VISTA ({', '.join(etiquetas)}): esta fuente sostiene "
        "algo distinto a lo que enseña la Biblia. Puedes usarla si aporta —para "
        "el dato, para el contexto o para responderla—. Si la usas, di también "
        "qué enseña la Biblia sobre ese punto: "
        f"{'; '.join(deberes)}."
    )


def counter_directive(topics: Iterable[str]) -> str:
    """
    Mensaje de sistema a inyectar cuando la investigación ha traído material
    marcado. Es el recordatorio de nivel de turno; ``counter_note`` es el de
    nivel de resultado.
    """
    pendientes = []
    for topic_id in dict.fromkeys(topics):
        topic = topic_by_id(topic_id)
        if topic is not None:
            pendientes.append(f"«{topic.label}» → {topic.research}")

    if not pendientes:
        return ""

    return (
        "Parte del material externo que has recogido sostiene puntos de vista "
        "distintos a los de la Biblia. Úsalo si aporta algo; no hace falta que "
        "lo evites. Lo único que se pide: de lo que acabes usando de ahí, di "
        "también qué enseña la Biblia, con su referencia. Los puntos que "
        "tocaste: " + "; ".join(pendientes) + "."
    )


def filter_results(results: Iterable[dict]) -> tuple[list[dict], list[str], int]:
    """
    Aplica el filtro a una lista de resultados externos.

    Devuelve ``(supervivientes, temas_a_contrastar, cuántos_se_bloquearon)``.
    Los que sobreviven llevan añadido ``aviso_doctrinal`` cuando toca.
    """
    supervivientes: list[dict] = []
    temas: list[str] = []
    bloqueados = 0

    for item in results:
        if not isinstance(item, dict):
            continue

        verdict = inspect(
            item.get("titulo") or item.get("title"),
            item.get("resumen") or item.get("snippet") or item.get("abstract"),
            item.get("url") or item.get("fuente"),
        )

        if verdict.blocked:
            bloqueados += 1
            continue

        if verdict.needs_counter:
            nota = counter_note(verdict.topics)
            if nota:
                item["aviso_doctrinal"] = nota
            temas.extend(verdict.topics)

        supervivientes.append(item)

    return supervivientes, list(dict.fromkeys(temas)), bloqueados


__all__ = [
    "ALLOW",
    "BLOCK",
    "COUNTER",
    "CONFLICT_TOPICS",
    "ConflictTopic",
    "Verdict",
    "blocked_domains",
    "counter_directive",
    "counter_note",
    "filter_results",
    "inspect",
    "normalize",
    "topic_by_id",
]
