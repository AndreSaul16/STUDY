"""
JWPUB Router — endpoints para subir y leer archivos .jwpub.

POST /api/jwpub/upload   — sube un .jwpub, lo desencripta y devuelve la estructura
GET  /api/jwpub/list     — lista las publicaciones cargadas en memoria
GET  /api/jwpub/{symbol} — devuelve una publicación completa con todos sus documentos
GET  /api/jwpub/{symbol}/doc/{doc_id} — devuelve un documento específico
"""
import json
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from ..schemas.jwpub_schemas import JWPUBImportResult, JWPUBPublication, JWPUBDocument, JWPUBTOCItem
from ..services.jwpub import JWPUBReader, JWPUBError

router = APIRouter(prefix="/api/jwpub", tags=["jwpub"])

_reader = JWPUBReader()

# Cache en memoria: symbol → publicación completa
# (en producción, usar Redis o SQLite en backend)
_publications_cache: dict[str, dict] = {}


@router.post("/upload", response_model=JWPUBImportResult)
async def upload_jwpub(file: UploadFile = File(...)):
    """
    Sube un archivo .jwpub, lo desencripta y devuelve la estructura completa.

    El archivo se procesa en memoria y se cachea por symbol para acceso rápido.
    """
    if not file.filename or not file.filename.endswith(".jwpub"):
        raise HTTPException(400, "File must have .jwpub extension")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "Empty file")

    try:
        result = _reader.read(file_bytes)

        # Extraer metadata de la publicación
        pub_info = result.get("publication", {})
        symbol = pub_info.get("symbol", file.filename)

        # Cachear la publicación completa
        _publications_cache[symbol] = result

        # Construir respuesta
        documents = [
            JWPUBDocument(**doc) for doc in result.get("documents", [])
        ]
        toc = [JWPUBTOCItem(**item) for item in result.get("toc", [])]

        return JWPUBImportResult(
            success=True,
            publication=JWPUBPublication(
                symbol=pub_info.get("symbol", ""),
                title=pub_info.get("title", ""),
                year=pub_info.get("year", 0),
                language=pub_info.get("language", 0),
                issueTagNumber=pub_info.get("issueTagNumber", 0),
                publicationType=pub_info.get("publicationType", ""),
                categories=pub_info.get("categories", []),
            ),
            documentCount=len(documents),
            documents=documents,
            toc=toc,
        )
    except JWPUBError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"JWPUB processing failed: {e}")


@router.get("/list")
async def list_publications():
    """Lista las publicaciones cargadas en memoria."""
    pubs = []
    for symbol, data in _publications_cache.items():
        pub_info = data.get("publication", {})
        pubs.append({
            "symbol": symbol,
            "title": pub_info.get("title", ""),
            "year": pub_info.get("year", 0),
            "language": pub_info.get("language", 0),
            "documentCount": len(data.get("documents", [])),
        })
    return {"publications": pubs}


@router.get("/{symbol}")
async def get_publication(symbol: str):
    """Devuelve una publicación completa con todos sus documentos."""
    if symbol not in _publications_cache:
        raise HTTPException(404, f"Publication '{symbol}' not found. Upload it first.")

    data = _publications_cache[symbol]
    return {
        "publication": data.get("publication", {}),
        "documents": data.get("documents", []),
        "toc": data.get("toc", []),
    }


@router.get("/{symbol}/doc/{doc_id}")
async def get_document(symbol: str, doc_id: int):
    """Devuelve un documento específico de una publicación."""
    if symbol not in _publications_cache:
        raise HTTPException(404, f"Publication '{symbol}' not found.")

    data = _publications_cache[symbol]
    documents = data.get("documents", [])

    for doc in documents:
        if doc.get("DocumentId") == doc_id:
            return {
                "publication": data.get("publication", {}),
                "document": doc,
            }

    raise HTTPException(404, f"Document {doc_id} not found in '{symbol}'")
