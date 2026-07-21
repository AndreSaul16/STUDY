"""Utilidades para lectura segura de uploads (límite de tamaño en chunks)."""

from fastapi import HTTPException, UploadFile

CHUNK_SIZE = 1024 * 1024  # 1 MB


async def read_upload_limited(file: UploadFile, max_size: int) -> bytes:
    """Lee un UploadFile en chunks de 1MB, abortando si supera max_size.

    Evita cargar en memoria un archivo gigante de golpe (DoS). Lanza
    HTTPException 413 en cuanto se supera el límite.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise HTTPException(
                413, f"File too large: exceeds max {max_size} bytes"
            )
        chunks.append(chunk)
    return b"".join(chunks)
