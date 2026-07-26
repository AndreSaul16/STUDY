"""
ContentCache — caché persistente del contenido de wol.jw.org.

Por qué existe: cada lectura salía a la red. Abrir un capítulo tardaba
segundos, y el chat repetía las mismas descargas en cada pregunta. Había
cachés en memoria, pero minúsculas (64 documentos, 128 búsquedas) y se
perdían al reiniciar el proceso.

Esta guarda en SQLite y aprovecha una propiedad del contenido: **es
inmutable**. Un artículo de La Atalaya de 2006 no va a cambiar, ni el texto de
Levítico 1. Se descarga una vez y ya.

Dos políticas, porque no todo caduca igual:

  * documentos y capítulos → permanentes (el contenido no cambia)
  * búsquedas              → caducan (WOL sí añade publicaciones nuevas)

Vive en el backend, no en el navegador, a propósito: así la aprovechan tanto
el lector como las herramientas del chat —que corren aquí— y se comparte entre
todos los dispositivos del usuario.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Ruta del archivo. En Railway el disco del contenedor es efímero: la caché
# dura lo que dure el despliegue, que ya es muchísimo más que un proceso.
# Con un volumen montado, apuntar CONTENT_CACHE_PATH a él la hace permanente.
_DEFAULT_PATH = Path(__file__).resolve().parents[3] / ".cache" / "content.db"
_CACHE_PATH = Path(os.getenv("CONTENT_CACHE_PATH", str(_DEFAULT_PATH)))

# Cuánto vale una búsqueda antes de repetirla.
_SEARCH_TTL_SECONDS = 14 * 24 * 3600

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS content (
    kind        TEXT NOT NULL,
    key         TEXT NOT NULL,
    payload     TEXT NOT NULL,
    stored_at   INTEGER NOT NULL,
    expires_at  INTEGER,
    PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS idx_content_expiry ON content(expires_at);
"""


def _connect() -> Optional[sqlite3.Connection]:
    """
    Abre (una vez) la base de la caché.

    Si falla —disco de solo lectura, permisos— se devuelve None y todo el
    módulo se comporta como si no hubiera caché. Una caché rota nunca debe
    impedir leer la Biblia.
    """
    global _conn
    if _conn is not None:
        return _conn

    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(_CACHE_PATH), check_same_thread=False)
        conn.executescript(_SCHEMA)
        # WAL: el backend lee y escribe desde varios hilos (FastAPI usa un
        # threadpool para el código síncrono).
        conn.execute("PRAGMA journal_mode = WAL")
        conn.commit()
        _conn = conn
        logger.info("Caché de contenido en %s", _CACHE_PATH)
        return _conn
    except Exception:  # noqa: BLE001
        logger.warning("No se pudo abrir la caché de contenido; se sigue sin ella",
                       exc_info=True)
        return None


def get(kind: str, key: str) -> Optional[Any]:
    """Devuelve lo cacheado, o None si no está o ya caducó."""
    conn = _connect()
    if conn is None:
        return None

    try:
        with _lock:
            row = conn.execute(
                "SELECT payload, expires_at FROM content WHERE kind = ? AND key = ?",
                (kind, key),
            ).fetchone()
    except sqlite3.Error:
        logger.warning("Lectura de caché fallida (%s/%s)", kind, key, exc_info=True)
        return None

    if row is None:
        return None

    payload, expires_at = row
    if expires_at is not None and expires_at < int(time.time()):
        delete(kind, key)
        return None

    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        # Entrada corrupta: se descarta en vez de propagar el error.
        delete(kind, key)
        return None


def put(kind: str, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
    """
    Guarda un valor. Sin `ttl_seconds`, permanente.

    Nunca lanza: que no se pueda cachear no debe romper la petición que ya
    tiene el contenido en la mano.
    """
    conn = _connect()
    if conn is None:
        return

    ahora = int(time.time())
    expires_at = ahora + ttl_seconds if ttl_seconds else None

    try:
        with _lock:
            conn.execute(
                "INSERT OR REPLACE INTO content (kind, key, payload, stored_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (kind, key, json.dumps(value, ensure_ascii=False), ahora, expires_at),
            )
            conn.commit()
    except Exception:  # noqa: BLE001
        logger.warning("Escritura de caché fallida (%s/%s)", kind, key, exc_info=True)


def delete(kind: str, key: str) -> None:
    """Borra una entrada."""
    conn = _connect()
    if conn is None:
        return
    try:
        with _lock:
            conn.execute("DELETE FROM content WHERE kind = ? AND key = ?", (kind, key))
            conn.commit()
    except sqlite3.Error:
        pass


def search_ttl() -> int:
    """TTL para resultados de búsqueda (los documentos no caducan)."""
    return _SEARCH_TTL_SECONDS


def stats() -> dict:
    """Cuánto hay cacheado, por tipo. Para el endpoint de diagnóstico."""
    conn = _connect()
    if conn is None:
        return {"available": False, "entries": {}}

    try:
        with _lock:
            filas = conn.execute(
                "SELECT kind, COUNT(*), SUM(LENGTH(payload)) FROM content GROUP BY kind"
            ).fetchall()
        return {
            "available": True,
            "path": str(_CACHE_PATH),
            "entries": {k: {"count": n, "bytes": b or 0} for k, n, b in filas},
        }
    except sqlite3.Error:
        return {"available": False, "entries": {}}
