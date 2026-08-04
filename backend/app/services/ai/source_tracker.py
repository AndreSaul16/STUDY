"""
Source tracker — extrae las fuentes consultadas a partir de los resultados de
las herramientas.

Por qué existe: la respuesta del chat vale lo que valen sus fuentes, pero hoy
esas fuentes solo viven dentro del texto que redacta el modelo. Aquí las
recogemos en paralelo, con sus metadatos reales (doc_id, cita, url), para que
la interfaz pueda ofrecer chips tocables que abran el artículo o el pasaje.

Sin red y sin estado global: recibe los dicts que ya devolvieron las
herramientas. Eso lo hace 100 % testeable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from .local_library import LocalSnippet

# Un solo `buscar_en_biblioteca` puede devolver 10 resultados. Mostrar diez
# chips de búsqueda tapa las fuentes que el modelo sí abrió y leyó.
_MAX_SEARCH_SOURCES = 5


@dataclass(frozen=True)
class Source:
    """Una fuente consultada, con lo justo para pintarla y para abrirla."""

    kind: str
    """"scripture" | "article" | "search" | "daily" | "video" | "external" |
    "local" | "mcp"."""
    label: str
    citation: str = ""
    url: str = ""
    doc_id: Optional[int] = None
    identifier: Optional[str] = None
    """Identificador del ReferenceEngine, ej. "scripture:isaías:58:12"."""

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"kind": self.kind, "label": self.label}
        if self.citation:
            data["citation"] = self.citation
        if self.url:
            data["url"] = self.url
        if self.doc_id is not None:
            data["doc_id"] = self.doc_id
        if self.identifier:
            data["identifier"] = self.identifier
        return data

    @property
    def dedupe_key(self) -> tuple:
        return (self.kind, self.label, self.doc_id)


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass
class SourceTracker:
    """Acumula las fuentes de una petición de chat, sin duplicados."""

    _sources: List[Source] = field(default_factory=list)
    _seen: set = field(default_factory=set)

    # ─── Registro ────────────────────────────────────────────────

    def record(self, tool_name: str, args: Any, result: Any) -> None:
        """
        Registra las fuentes de una ejecución de herramienta.

        Nunca lanza: una forma inesperada de ``result`` (una herramienta MCP
        que no conocemos, un error de red) no puede tumbar el stream. Un
        resultado con ``error`` no genera fuente: no se consultó nada.
        """
        payload = _as_dict(result)
        if not payload or "error" in payload:
            return

        arguments = _as_dict(args)
        try:
            for source in self._extract(str(tool_name), arguments, payload):
                if source.dedupe_key in self._seen:
                    continue
                self._seen.add(source.dedupe_key)
                self._sources.append(source)
        except Exception:  # noqa: BLE001 — nunca romper el stream por una fuente
            return

    def record_local_library(self, snippets: Iterable[LocalSnippet]) -> None:
        """
        Registra los fragmentos que aportó el propio usuario desde su .jwpub.

        Método aparte de ``record`` porque esto NO es el resultado de una
        herramienta: nadie fue a buscarlo, llegó con la petición. Aun así son
        fuentes de pleno derecho —la respuesta se apoya en ellas— y tienen que
        aparecer entre los chips, con su propio ``kind`` para que el usuario vea
        de un vistazo que ese trozo salió de su biblioteca y no de wol.jw.org.

        El ``identifier`` (``jwpub:<símbolo>:<id>``) permite que la interfaz
        abra el documento desde IndexedDB. NO se usa ``doc_id``: ese campo
        significa "documento de la Biblioteca en Línea" en todo el resto del
        contrato, y un ``DocumentId`` de un .jwpub metido ahí haría que el chip
        abriera un artículo de wol.jw.org que no tiene nada que ver.
        """
        for snippet in snippets:
            label = snippet.label
            if not label:
                continue
            identifier = (
                f"jwpub:{snippet.symbol}:{snippet.document_id}"
                if snippet.symbol and snippet.document_id is not None
                else None
            )
            source = Source(
                kind="local",
                label=label,
                citation=snippet.publication,
                identifier=identifier,
            )
            if source.dedupe_key in self._seen:
                continue
            self._seen.add(source.dedupe_key)
            self._sources.append(source)

    def _extract(
        self, tool_name: str, args: Dict[str, Any], result: Dict[str, Any]
    ) -> List[Source]:
        if tool_name == "leer_pasaje_biblico":
            return self._from_scripture(args, result)
        if tool_name == "abrir_documento":
            return self._from_document(args, result)
        if tool_name in ("buscar_en_biblioteca", "buscar_en_jw_org"):
            return self._from_search(result)
        if tool_name == "abrir_video":
            return self._from_video(result)
        if tool_name == "buscar_en_internet":
            return self._from_external(result)
        if tool_name == "obtener_texto_del_dia":
            return self._from_daily(result)
        return self._from_mcp(result)

    @staticmethod
    def _from_scripture(
        args: Dict[str, Any], result: Dict[str, Any]
    ) -> List[Source]:
        titulo = _text(result.get("titulo"))
        if not titulo:
            return []

        # Mismo normalizado que native_tools._leer_pasaje_biblico: minúsculas
        # sin quitar acentos. El frontend reusa este identifier tal cual.
        identifier = None
        libro = _text(args.get("libro"))
        capitulo = _int_or_none(args.get("capitulo"))
        if libro and capitulo is not None:
            versiculo = _text(args.get("versiculo")).lower() or "all"
            identifier = f"scripture:{libro.lower()}:{capitulo}:{versiculo}"

        return [
            Source(
                kind="scripture",
                label=titulo,
                url=_text(result.get("fuente")),
                identifier=identifier,
            )
        ]

    @staticmethod
    def _from_document(
        args: Dict[str, Any], result: Dict[str, Any]
    ) -> List[Source]:
        titulo = _text(result.get("titulo"))
        if not titulo:
            return []
        return [
            Source(
                kind="article",
                label=titulo,
                citation=_text(result.get("publicacion")),
                url=_text(result.get("fuente")),
                doc_id=_int_or_none(args.get("doc_id")),
            )
        ]

    @staticmethod
    def _from_search(result: Dict[str, Any]) -> List[Source]:
        """
        Fuentes de una búsqueda, sea de WOL o de jw.org.

        Los dos catálogos devuelven claves distintas —WOL trae ``citation`` y
        ``publication``, jw.org trae ``titulo`` y ``publicacion``— y aquí se
        cubren las dos formas en vez de duplicar el método: lo que la interfaz
        necesita es lo mismo, una etiqueta y algo con lo que abrirlo.
        """
        raw = result.get("resultados")
        if not isinstance(raw, list):
            return []

        sources: List[Source] = []
        for item in raw[:_MAX_SEARCH_SOURCES]:
            entry = _as_dict(item)
            citation = _text(entry.get("citation")) or _text(entry.get("publicacion"))
            label = (
                _text(entry.get("citation"))
                or _text(entry.get("titulo"))
                or _text(entry.get("publication"))
                or citation
            )
            if not label:
                continue
            sources.append(
                Source(
                    kind="search",
                    label=label,
                    citation=citation,
                    url=_text(entry.get("url")),
                    doc_id=_int_or_none(entry.get("doc_id")),
                )
            )
        return sources

    @staticmethod
    def _from_video(result: Dict[str, Any]) -> List[Source]:
        titulo = _text(result.get("titulo"))
        if not titulo:
            return []
        anio = result.get("anio")
        return [
            Source(
                kind="video",
                label=titulo,
                citation=" · ".join(
                    p for p in (str(anio) if anio else "", _text(result.get("duracion"))) if p
                ),
                url=_text(result.get("fuente")),
            )
        ]

    @staticmethod
    def _from_external(result: Dict[str, Any]) -> List[Source]:
        """
        Fuentes de fuera de jw.org.

        Se distinguen con su propio ``kind`` a propósito: en la interfaz tienen
        que verse como lo que son —material externo— y no mezclarse con las
        publicaciones. Un chip de La Atalaya y uno de una revista científica no
        pesan lo mismo, y el usuario debe poder distinguirlos de un vistazo.
        """
        raw = result.get("resultados")
        if not isinstance(raw, list):
            return []

        sources: List[Source] = []
        for item in raw[:_MAX_SEARCH_SOURCES]:
            entry = _as_dict(item)
            titulo = _text(entry.get("titulo"))
            if not titulo:
                continue
            anio = entry.get("anio")
            revista = _text(entry.get("publicado_en"))
            sources.append(
                Source(
                    kind="external",
                    label=titulo,
                    citation=" · ".join(p for p in (revista, str(anio) if anio else "") if p),
                    url=_text(entry.get("url")),
                )
            )
        return sources

    @staticmethod
    def _from_daily(result: Dict[str, Any]) -> List[Source]:
        label = _text(result.get("date_label"))
        if not label:
            return []
        return [
            Source(
                kind="daily",
                label=f"Texto del día · {label}",
                citation=_text(result.get("theme_scripture_ref")),
                url=_text(result.get("source_url")),
            )
        ]

    @staticmethod
    def _from_mcp(result: Dict[str, Any]) -> List[Source]:
        """Best-effort para el MCP: formas heterogéneas y en inglés."""
        label = _text(result.get("title")) or _text(result.get("titulo"))
        if not label:
            return []
        return [
            Source(
                kind="mcp",
                label=label,
                citation=_text(result.get("citation")),
                url=_text(result.get("url")) or _text(result.get("source_url")),
            )
        ]

    # ─── Lectura ─────────────────────────────────────────────────

    def sources(self) -> List[Dict[str, Any]]:
        """Fuentes deduplicadas, en el orden en que se consultaron."""
        return [s.to_dict() for s in self._sources]

    def __len__(self) -> int:
        return len(self._sources)

    # ─── Resumen para el rastro de actividad ─────────────────────

    @staticmethod
    def summary(tool_name: str, result: Any) -> str:
        """
        Una línea de lo que devolvió la herramienta, para el rastro que ve el
        usuario mientras la IA investiga ("6 resultados", "Isaías 58").
        """
        payload = _as_dict(result)
        if not payload:
            return ""
        error = _text(payload.get("error"))
        if error:
            return "Sin resultado"

        if tool_name in ("buscar_en_biblioteca", "buscar_en_jw_org", "buscar_en_internet"):
            raw = payload.get("resultados")
            total = len(raw) if isinstance(raw, list) else 0
            if total == 0:
                return "Sin resultados"
            donde = {
                "buscar_en_jw_org": " en jw.org",
                "buscar_en_internet": " externos",
            }.get(tool_name, "")
            return f"{total} resultado{'s' if total != 1 else ''}{donde}"

        if tool_name == "abrir_video":
            titulo = _text(payload.get("titulo"))
            if not titulo:
                return "Vídeo leído"
            return titulo if payload.get("transcripcion") else f"{titulo} (sin subtítulos)"

        if tool_name == "leer_pasaje_biblico":
            return _text(payload.get("titulo")) or "Pasaje leído"

        if tool_name == "abrir_documento":
            titulo = _text(payload.get("titulo"))
            if not titulo:
                return "Artículo leído"
            return f"{titulo} (truncado)" if payload.get("truncado") else titulo

        if tool_name == "obtener_texto_del_dia":
            return _text(payload.get("date_label")) or "Texto del día"

        return _text(payload.get("title")) or "Consultado"
