"""
Interop Router — endpoints para import/export de archivos .jwlibrary.

POST /api/interop/import      — analiza un .jwlibrary subido
POST /api/interop/export      — inyecta datos en un .jwlibrary y devuelve el ZIP
GET  /api/interop/schema      — devuelve el esquema SQL de userData.db

Los archivos se suben como multipart/form-data.
Las respuestas de export son StreamingResponse con el ZIP.
"""

import io
import json
import logging

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse

from ..schemas.interop_schemas import ExportRequest, ImportResult, ExportResult
from ..services.interop import JWLibraryReader, JWLibraryWriter, JWLibraryError
from ..upload_utils import read_upload_limited

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interop", tags=["interop"])

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

# Singletons
_reader = JWLibraryReader()
_writer = JWLibraryWriter()


def _export_result_header(result: ExportResult) -> str:
    """Serializa el ExportResult para el header HTTP X-Export-Result.

    Los headers HTTP solo admiten ASCII; excluimos `errors` (texto libre,
    puede contener no-ASCII) y forzamos ensure_ascii.
    """
    payload = result.model_dump()
    payload.pop("errors", None)
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


@router.post("/import", response_model=ImportResult)
async def import_jwlibrary(file: UploadFile = File(...)):
    """
    Analiza un archivo .jwlibrary subido.

    Descomprime el ZIP, lee userData.db y devuelve un ImportResult
    con los conteos de marcas, notas, etiquetas y documentos encontrados.
    No modifica el archivo.
    """
    if not file.filename or not file.filename.endswith(".jwlibrary"):
        raise HTTPException(400, "File must have .jwlibrary extension")

    file_bytes = await read_upload_limited(file, MAX_UPLOAD_SIZE)
    if not file_bytes:
        raise HTTPException(400, "Empty file")

    try:
        result, _db_bytes, _manifest = _reader.read(file_bytes)
        return result
    except JWLibraryError as e:
        raise HTTPException(422, str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Import failed")
        raise HTTPException(500, "Import failed")


@router.post("/export")
async def export_jwlibrary(
    file: UploadFile = File(...),
    request_json: str = Form(...),
):
    """
    Inyecta datos en un .jwlibrary existente y devuelve el ZIP modificado.

    - file: el .jwlibrary original (multipart)
    - request_json: ExportRequest serializada como JSON string (multipart form)

    Devuelve el nuevo .jwlibrary como descarga (application/octet-stream).
    """
    if not file.filename or not file.filename.endswith(".jwlibrary"):
        raise HTTPException(400, "File must have .jwlibrary extension")

    try:
        request = ExportRequest.model_validate_json(request_json)
    except Exception as e:
        raise HTTPException(400, f"Invalid request JSON: {e}")

    file_bytes = await read_upload_limited(file, MAX_UPLOAD_SIZE)
    if not file_bytes:
        raise HTTPException(400, "Empty file")

    try:
        # Leer el ZIP original para obtener userData.db
        result, db_bytes, _manifest = _reader.read(file_bytes)
        if not db_bytes:
            raise HTTPException(422, "userData.db not found in archive")

        # Inyectar datos
        export_result, new_zip = _writer.write(file_bytes, db_bytes, request)

        if not export_result.success:
            raise HTTPException(
                500,
                f"Export failed: {'; '.join(export_result.errors)}",
            )

        # Devolver como descarga
        return StreamingResponse(
            io.BytesIO(new_zip),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="study-export.jwlibrary"',
                "X-Export-Result": _export_result_header(export_result),
            },
        )
    except JWLibraryError as e:
        raise HTTPException(422, str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Export failed")
        raise HTTPException(500, "Export failed")


@router.get("/schema")
async def get_schema():
    """Devuelve el esquema SQL de userData.db para referencia."""
    from ..schemas.interop_schemas import USERDATA_DB_SCHEMA

    return {"schema": USERDATA_DB_SCHEMA, "tables": [
        "UserMark", "BlockRange", "Note", "Tag", "NoteTag", "Bookmark"
    ]}


@router.get("/colors")
async def get_colors():
    """Devuelve el mapeo de colores de UserMark."""
    from ..schemas.interop_schemas import JWMarkColor

    return {
        "colors": [
            {"id": c.value, "name": c.name.lower()}
            for c in JWMarkColor
        ]
    }
