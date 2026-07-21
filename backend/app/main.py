"""
Study Backend — FastAPI application entry point.

Expone:
  - /api/ai/analyze      (SSE streaming)
  - /api/ai/analyze-sync (no streaming)
  - /api/ai/skills       (lista de skills)
  - /api/ai/health       (health check)

El MCPContentService existente se integra en fases posteriores.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.ai_router import router as ai_router
from .routers.interop_router import router as interop_router
from .routers.jwpub_router import router as jwpub_router
from .routers.chat_router import router as chat_router

app = FastAPI(
    title="Study Backend",
    description="Backend para la app de estudio con IA desacoplada, MCP e interoperabilidad .jwlibrary.",
    version="0.3.0",
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
        "version": "0.2.0",
        "docs": "/docs",
        "ai_health": "/api/ai/health",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
