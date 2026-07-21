"""
Study Backend — FastAPI application entry point.

Expone:
  - /api/ai/analyze      (SSE streaming)
  - /api/ai/analyze-sync (no streaming)
  - /api/ai/skills       (lista de skills)
  - /api/ai/health       (health check)

El MCPContentService existente se integra en fases posteriores.
"""

import logging
from pathlib import Path

from dotenv import load_dotenv

# Cargar backend/.env ANTES de importar routers: chat_service lee OPENAI_*
# como constantes a nivel de módulo en import time.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logging.basicConfig(level=logging.INFO)

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.ai_router import router as ai_router
from .routers.interop_router import router as interop_router
from .routers.jwpub_router import router as jwpub_router
from .routers.chat_router import router as chat_router
from .services.ai.mcp_bridge import shutdown_mcp_bridge

APP_VERSION = "0.3.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # No inicializamos el MCP bridge en startup: se crea perezosamente.
    yield
    # Cerrar el subprocess del MCP bridge al apagar la app.
    shutdown_mcp_bridge()


app = FastAPI(
    title="Study Backend",
    description="Backend para la app de estudio con IA desacoplada, MCP e interoperabilidad .jwlibrary.",
    version=APP_VERSION,
    lifespan=lifespan,
)

# CORS — permitir el frontend de Vite en desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(ai_router)
app.include_router(interop_router)
app.include_router(jwpub_router)
app.include_router(chat_router)


@app.get("/")
async def root():
    return {
        "name": "Study Backend",
        "version": APP_VERSION,
        "docs": "/docs",
        "ai_health": "/api/ai/health",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
