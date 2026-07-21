"""
JWPUB Reader — descomprime y desencripta archivos .jwpub.

Un archivo .jwpub es un ZIP que contiene:
  - manifest.json   (metadata: symbol, year, language, title)
  - contents        (ZIP interno con symbol.db + media)

El symbol.db es un SQLite donde la columna Document.Content está cifrada
con AES-128-CBC. La clave se deriva así:
  1. String: "{MepsLanguageIndex}_{Symbol}_{Year}" (+ "_{IssueTagNumber}" si non-zero)
  2. SHA-256 → 32 bytes
  3. XOR con constante: 11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7
  4. Primeros 16 bytes = AES key, últimos 16 = IV
  5. Content está zlib-compressed + AES cifrado

Seguridad:
  - No ejecuta SQL del archivo (solo SELECT)
  - Valida path traversal en ZIP
  - Límite 200MB
"""

import io
import os
import json
import hashlib
import tempfile
import zipfile
import sqlite3
import zlib
from typing import BinaryIO, Optional, Tuple, List, Dict, Any
from Crypto.Cipher import AES

MAX_JWPUB_SIZE = 200 * 1024 * 1024  # 200 MB
MAX_DOC_HTML = 50 * 1024 * 1024  # 50 MB — límite por documento descomprimido
XOR_CONSTANT = bytes.fromhex(
    "11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7"
)


class JWPUBError(Exception):
    """Error base para problemas de lectura JWPUB."""
    pass


class JWPUBReader:
    """Lee y desencripta archivos .jwpub."""

    def read(self, file_data: bytes) -> Dict[str, Any]:
        """
        Descomprime un .jwpub, desencripta symbol.db y devuelve
        la estructura completa: metadata + documentos + TOC.

        Returns:
            {
                "manifest": {...},
                "publication": {
                    "symbol": "lff",
                    "title": "Disfrute de la vida para siempre",
                    "year": 2024,
                    "language": 1,
                    ...
                },
                "documents": [
                    {
                        "DocumentId": 0,
                        "Title": "Capítulo 1",
                        "Content": "<html>...</html>",
                        "ContentLength": 12345,
                    },
                    ...
                ],
                "toc": [
                    {
                        "Id": 1,
                        "ParentId": -1,
                        "Title": "Introducción",
                        "DocumentId": 0,
                    },
                    ...
                ],
            }
        """
        if len(file_data) > MAX_JWPUB_SIZE:
            raise JWPUBError(
                f"File too large: {len(file_data)} bytes (max {MAX_JWPUB_SIZE})"
            )

        # 1. Descomprimir ZIP externo
        try:
            outer_zip = zipfile.ZipFile(io.BytesIO(file_data), "r")
        except zipfile.BadZipFile:
            raise JWPUBError("Not a valid ZIP file")

        self._validate_zip_paths(outer_zip)
        self._check_zip_bomb(outer_zip)

        # 2. Leer manifest.json
        manifest = self._read_manifest(outer_zip)

        # 3. Leer contents (ZIP interno)
        contents_data = self._read_contents(outer_zip)
        inner_zip = zipfile.ZipFile(io.BytesIO(contents_data), "r")
        self._validate_zip_paths(inner_zip)
        self._check_zip_bomb(inner_zip)

        # 4. Extraer symbol.db
        db_name = manifest.get("publication", {}).get("fileName", "symbol.db")
        db_bytes = self._extract_db(inner_zip, db_name)

        # 5. Derivar clave de cifrado
        pub_info = manifest.get("publication", {})
        symbol = pub_info.get("symbol", "")
        year = pub_info.get("year", 0)
        language = pub_info.get("language", 0)
        issue_tag = pub_info.get("issueTagNumber", 0)

        key, iv = self._derive_key(symbol, year, language, issue_tag)

        # 6. Leer SQLite y desencriptar documentos
        documents, toc = self._read_sqlite(db_bytes, key, iv)

        return {
            "manifest": manifest,
            "publication": pub_info,
            "documents": documents,
            "toc": toc,
        }

    def _validate_zip_paths(self, zf: zipfile.ZipFile) -> None:
        """Previene path traversal en ZIP."""
        for info in zf.infolist():
            name = info.filename
            if name.startswith("/") or ".." in name:
                raise JWPUBError(f"Path traversal detected: {name}")

    def _check_zip_bomb(self, zf: zipfile.ZipFile) -> None:
        """Rechaza ZIPs cuyo tamaño descomprimido declarado es excesivo."""
        total = 0
        for info in zf.infolist():
            if info.file_size > MAX_JWPUB_SIZE:
                raise JWPUBError(
                    f"ZIP entry too large: {info.filename} "
                    f"({info.file_size} bytes)"
                )
            total += info.file_size
        if total > 4 * MAX_JWPUB_SIZE:
            raise JWPUBError(
                "ZIP uncompressed size too large (possible zip bomb)"
            )

    def _read_manifest(self, zf: zipfile.ZipFile) -> Dict[str, Any]:
        """Lee manifest.json del ZIP externo."""
        try:
            manifest_bytes = zf.read("manifest.json")
            return json.loads(manifest_bytes.decode("utf-8"))
        except KeyError:
            raise JWPUBError("manifest.json not found in JWPUB")
        except json.JSONDecodeError as e:
            raise JWPUBError(f"Invalid manifest.json: {e}")

    def _read_contents(self, zf: zipfile.ZipFile) -> bytes:
        """Lee el archivo 'contents' (ZIP interno)."""
        try:
            return zf.read("contents")
        except KeyError:
            raise JWPUBError("contents file not found in JWPUB")

    def _extract_db(self, zf: zipfile.ZipFile, db_name: str) -> bytes:
        """Extrae el SQLite del ZIP interno."""
        # Buscar el archivo .db (puede tener cualquier nombre)
        db_files = [f for f in zf.namelist() if f.endswith(".db")]
        if not db_files:
            raise JWPUBError("No .db file found in contents")

        # Usar el nombre del manifest o el primer .db encontrado
        target = db_name if db_name in db_files else db_files[0]
        return zf.read(target)

    def _derive_key(
        self, symbol: str, year: int, language: int, issue_tag: int = 0
    ) -> Tuple[bytes, bytes]:
        """
        Deriva la clave AES-128-CBC y el IV.

        Algoritmo:
          1. String: "{lang}_{symbol}_{year}" (+ "_{issue_tag}" si non-zero)
          2. SHA-256 → 32 bytes
          3. XOR con constante
          4. Primeros 16 bytes = key, últimos 16 = IV
        """
        key_string = f"{language}_{symbol}_{year}"
        if issue_tag and issue_tag != 0:
            key_string += f"_{issue_tag}"

        sha256 = hashlib.sha256(key_string.encode("utf-8")).digest()

        # XOR con constante
        xored = bytes(a ^ b for a, b in zip(sha256, XOR_CONSTANT))

        key = xored[:16]
        iv = xored[16:]
        return key, iv

    def _decrypt_content(self, encrypted: bytes, key: bytes, iv: bytes) -> str:
        """
        Desencripta un BLOB de Document.Content:
          AES-128-CBC → zlib decompress → UTF-8 HTML
        """
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(encrypted)

        # Quitar padding PKCS7 (validando que el padding sea consistente)
        if not decrypted:
            raise JWPUBError("Empty decrypted content")
        pad_len = decrypted[-1]
        if 1 <= pad_len <= 16 and decrypted[-pad_len:] == bytes([pad_len]) * pad_len:
            decrypted = decrypted[:-pad_len]

        # Descomprimir zlib con límite (protección zip-bomb por documento)
        try:
            decompressor = zlib.decompressobj()
            html_bytes = decompressor.decompress(decrypted, MAX_DOC_HTML)
            if decompressor.unconsumed_tail:
                raise JWPUBError("Decompressed document exceeds size limit")
        except zlib.error:
            # Si falla zlib, intentar sin descomprimir
            html_bytes = decrypted

        return html_bytes.decode("utf-8", errors="replace")

    def _read_sqlite(
        self, db_bytes: bytes, key: bytes, iv: bytes
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Lee el SQLite y desencripta los documentos.

        Returns:
            (documents, toc)
            documents: lista de {DocumentId, Title, Content, ContentLength}
            toc: lista de {Id, ParentId, Title, DocumentId}
        """
        # sqlite3 no acepta bytes directamente, usar temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.write(db_bytes)
        tmp.close()

        try:
            conn = sqlite3.connect(tmp.name)
            conn.row_factory = sqlite3.Row

            documents = self._read_documents(conn, key, iv)
            toc = self._read_toc(conn)

            conn.close()
            return documents, toc
        finally:
            os.unlink(tmp.name)

    def _read_documents(
        self, conn: sqlite3.Connection, key: bytes, iv: bytes
    ) -> List[Dict[str, Any]]:
        """Lee y desencripta la tabla Document."""
        cursor = conn.execute(
            "SELECT DocumentId, Title, Content, ContentLength FROM Document ORDER BY DocumentId"
        )
        documents = []
        for row in cursor:
            content_blob = row["Content"]
            content = ""
            if content_blob:
                try:
                    content = self._decrypt_content(content_blob, key, iv)
                except Exception as e:
                    content = f"<!-- Decryption error: {e} -->"

            documents.append({
                "DocumentId": row["DocumentId"],
                "Title": row["Title"] or "",
                "Content": content,
                "ContentLength": row["ContentLength"] or len(content),
            })
        return documents

    def _read_toc(self, conn: sqlite3.Connection) -> List[Dict[str, Any]]:
        """Lee la tabla PublicationViewItem (TOC jerárquico)."""
        try:
            cursor = conn.execute(
                """SELECT Id, ParentPublicationViewItemId, Title, DocumentId
                   FROM PublicationViewItem ORDER BY Id"""
            )
            return [
                {
                    "Id": row["Id"],
                    "ParentId": row["ParentPublicationViewItemId"],
                    "Title": row["Title"] or "",
                    "DocumentId": row["DocumentId"],
                }
                for row in cursor
            ]
        except sqlite3.OperationalError:
            # Tabla no existe → TOC plano
            return []
