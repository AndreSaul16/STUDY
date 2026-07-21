"""
JWPUB Router — endpoints para subir y leer archivos .jwpub.

POST /api/jwpub/upload   — sube un .jwpub, lo desencripta y devuelve la estructura
GET  /api/jwpub/list     — lista las publicaciones cargadas en memoria
GET  /api/jwpub/{symbol} — devuelve una publicación completa con todos sus documentos
GET  /api/jwpub/{symbol}/doc/{doc_id} — devuelve un documento específico
"""
import logging
from collections import OrderedDict
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException

from ..schemas.jwpub_schemas import JWPUBImportResult, JWPUBPublication, JWPUBDocument, JWPUBTOCItem
from ..services.jwpub import JWPUBReader, JWPUBError
from ..upload_utils import read_upload_limited

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jwpub", tags=["jwpub"])

MAX_UPLOAD_SIZE = 200 * 1024 * 1024  # 200 MB

_reader = JWPUBReader()

# Cache LRU en memoria: symbol → publicación completa
# (en producción, usar Redis o SQLite en backend)
_MAX_CACHED_PUBLICATIONS = 5
_publications_cache: "OrderedDict[str, dict]" = OrderedDict()


def _cache_put(symbol: str, data: dict) -> None:
    """Inserta en el cache LRU, expulsando el más antiguo si excede el límite."""
    _publications_cache[symbol] = data
    _publications_cache.move_to_end(symbol)
    while len(_publications_cache) > _MAX_CACHED_PUBLICATIONS:
        _publications_cache.popitem(last=False)


def _cache_get(symbol: str) -> Optional[dict]:
    """Obtiene del cache LRU, marcando la entrada como usada recientemente."""
    if symbol not in _publications_cache:
        return None
    _publications_cache.move_to_end(symbol)
    return _publications_cache[symbol]


@router.post("/upload", response_model=JWPUBImportResult)
async def upload_jwpub(file: UploadFile = File(...)):
    """
    Sube un archivo .jwpub, lo desencripta y devuelve la estructura completa.

    El archivo se procesa en memoria y se cachea por symbol para acceso rápido.
    """
    if not file.filename or not file.filename.endswith(".jwpub"):
        raise HTTPException(400, "File must have .jwpub extension")

    file_bytes = await read_upload_limited(file, MAX_UPLOAD_SIZE)
    if not file_bytes:
        raise HTTPException(400, "Empty file")

    try:
        result = _reader.read(file_bytes)

        # Extraer metadata de la publicación
        pub_info = result.get("publication", {})
        symbol = pub_info.get("symbol", file.filename)

        # Cachear la publicación completa (LRU)
        _cache_put(symbol, result)

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
    except HTTPException:
        raise
    except Exception:
        logger.exception("JWPUB processing failed")
        raise HTTPException(500, "JWPUB processing failed")


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
    data = _cache_get(symbol)
    if data is None:
        raise HTTPException(404, f"Publication '{symbol}' not found. Upload it first.")

    return {
        "publication": data.get("publication", {}),
        "documents": data.get("documents", []),
        "toc": data.get("toc", []),
    }


@router.get("/{symbol}/doc/{doc_id}")
async def get_document(symbol: str, doc_id: int):
    """Devuelve un documento específico de una publicación."""
    data = _cache_get(symbol)
    if data is None:
        raise HTTPException(404, f"Publication '{symbol}' not found.")

    documents = data.get("documents", [])

    for doc in documents:
        if doc.get("DocumentId") == doc_id:
            return {
                "publication": data.get("publication", {}),
                "document": doc,
            }

    raise HTTPException(404, f"Document {doc_id} not found in '{symbol}'")
