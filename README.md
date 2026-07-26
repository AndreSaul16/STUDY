# Study — Escritorio de Lectura y Estudio

Aplicación web de estudio bíblico con visor de doble panel, motor de referencias automático, asistente de IA con streaming, persistencia local SQLite y interoperabilidad con archivos `.jwlibrary`.

## Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend | React + Vite + TypeScript | React 19, Vite 6, TS 5.9 |
| Estilos | Tailwind CSS | 4.3 (`@theme`, `@custom-variant`) |
| Estado | Zustand | 5.0 (con persist middleware) |
| Persistencia local | SQLite WASM (sql.js) | 1.14 |
| Búsqueda semántica | SQLite FTS5 | (bm25 ranking) |
| Backend | FastAPI (Python) | 0.115+ |
| IA | Patrón Provider (OpenAI/Mock) | Desacoplado |
| Contenido | MCP Server (advenimus-jw-mcp) | vía stdio |
| Interop | zipfile + sqlite3 (stdlib) | Python 3.10+ |

## Arquitectura de Módulos

```
STUDY/
├── backend/                         # FastAPI + MCP + IA + Interop
│   └── app/
│       ├── main.py                  # Entry point FastAPI
│       ├── schemas/
│       │   ├── domain_schemas.py    # Article, PublicationBlock (Pydantic)
│       │   ├── ai_schemas.py        # AIContext, AISkill, SSE events
│       │   └── interop_schemas.py   # DTOs .jwlibrary + esquema userData.db
│       ├── services/
│       │   ├── mcp_content_service.py  # Conexión MCP (advenimus-jw-mcp)
│       │   ├── ai/
│       │   │   ├── ai_service.py       # Orquestador IA
│       │   │   ├── prompt_orchestrator.py  # 7 skills + system prompts
│       │   │   ├── context_optimizer.py    # Ventana de contexto + token budget
│       │   │   └── providers/
│       │   │       ├── base.py          # AIEngineProvider (abstracto)
│       │   │       ├── mock_provider.py # Mock con streaming simulado
│       │   │       └── openai_provider.py  # OpenAI stub
│       │   └── interop/
│       │       ├── jwlibrary_reader.py  # Descomprimir ZIP + leer userData.db
│       │       ├── jwlibrary_writer.py  # Inyectar SQL + recomprimir
│       │       └── schema_mapper.py     # Mapeo modelo local → userData.db
│       └── routers/
│           ├── ai_router.py          # POST /api/ai/analyze (SSE)
│           └── interop_router.py     # POST /api/interop/import|export
│
└── frontend/                        # React 19 + Vite + Tailwind 4
    └── src/
        ├── App.tsx                  # Root (init DB + theme + atajos)
        ├── types/
        │   ├── domain.ts            # Article, Annotation, CrossReference
        │   ├── reference.ts         # Reference, ReferenceType, parsers/resolvers
        │   └── ai.ts                # AISkill, SSE events, SKILLS_METADATA
        ├── engine/                  # ReferenceEngine (detección + caché LRU)
        │   ├── ReferenceEngine.ts   # detect() + resolveReference() cache-first
        │   ├── LRUCache.ts          # Caché LRU con Map ordenado
        │   ├── registry.ts          # Factory: ReferenceType → {parser, resolver}
        │   ├── parsers/             # Strategy: Scripture, Publication, Footnote, CrossRef
        │   └── resolvers/           # Strategy: mock por tipo de referencia
        ├── db/                      # Persistencia SQLite WASM
        │   ├── schema.ts            # Esquema SQL local + FTS5
        │   ├── database.ts          # sql.js init + IndexedDB persistence
        │   └── repositories/        # DAOs: notes, marks, tags, history, search, favorites
        ├── store/                   # Zustand stores
        │   ├── uiStore.ts           # Theme, tabs, sheet, search
        │   ├── readerStore.ts       # Artículo + anotaciones
        │   ├── referenceStore.ts    # Referencia activa + historial
        │   └── aiStore.ts           # Stream state + results por skill
        ├── hooks/
        │   ├── useTextSelection.ts  # Selección de texto con offsets
        │   ├── useReferenceEngine.ts # Puente engine ↔ UI
        │   ├── useAIStream.ts       # fetch + ReadableStream SSE parser
        │   ├── useChapterSearch.ts  # Ctrl+F interno
        │   ├── useMediaQuery.ts     # Responsive
        │   ├── useDatabase.ts       # Init SQLite WASM
        │   └── useVirtualList.ts    # Virtualización sin deps
        ├── services/
        │   └── jwlibraryClient.ts   # Cliente HTTP interop
        ├── data/                    # Mock data
        ├── components/
        │   ├── atoms/               # Button, Icons, Skeleton, Badge, Divider, Tooltip
        │   ├── molecules/           # ContextMenu, SearchBar, NoteEditor, ReferenceCard, TabBar
        │   ├── organisms/           # ReaderPanel, ResearchPanel, AIPanel, NotesPanel, InteropPanel
        │   └── templates/           # SplitLayout (60/40 responsive)
        └── utils/cn.ts              # clsx + tailwind-merge
```

## Entorno de Desarrollo

### Prerrequisitos

- **Node.js** 20+ y **pnpm** (gestor de paquetes del frontend)
- **Python** 3.10+
- **Servidor MCP** `advenimus-jw-mcp` (instalado y en PATH)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# .venv\Scripts\activate   # Windows
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env y añadir OPENAI_API_KEY (y opcionalmente OPENAI_MODEL, JW_MCP_PATH)

# Iniciar
uvicorn app.main:app --reload --port 8000
```

El backend carga automáticamente `backend/.env` al arrancar (via `python-dotenv`).
`backend/.env.example` documenta las variables disponibles. `.env` está en `.gitignore`
y nunca debe commitearse.

El backend expone:
- `http://localhost:8000/` — root info
- `http://localhost:8000/docs` — Swagger UI
- `http://localhost:8000/api/ai/analyze` — SSE streaming de IA
- `http://localhost:8000/api/ai/skills` — lista de skills
- `http://localhost:8000/api/interop/import` — analizar .jwlibrary
- `http://localhost:8000/api/interop/export` — inyectar en .jwlibrary
- `http://localhost:8000/api/interop/schema` — esquema userData.db

### Conexión al servidor MCP

El `MCPContentService` se conecta al servidor MCP vía stdio:

```python
# backend/app/services/mcp_content_service.py
server_command = "advenimus-jw-mcp"  # Debe estar en PATH
```

Si el servidor MCP tiene otro nombre o ruta, configurarlo al instanciar:

```python
service = MCPContentService(server_command="/ruta/a/advenimus-jw-mcp")
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

El frontend se sirve en `http://localhost:5173`.

**Variables de entorno** (opcional, archivo `.env`):

```
VITE_AI_API_BASE=http://localhost:8000
```

### IA: chat vs. análisis

Ambos usan OpenAI real **si hay `OPENAI_API_KEY`**; sin ella, el análisis cae al
`MockProvider` para poder levantar el backend en local sin credenciales. La
selección es automática (`_build_service()` en `ai_router.py`), no hay que
tocar código.

- **Chat** (`/api/chat/stream`) — conversacional, con herramientas.
- **Análisis** (`/api/ai/analyze`) — las 7 skills sobre el texto que se está leyendo.

#### `reasoning_effort`: dos restricciones reales de la API

Con modelos de razonamiento (`gpt-5.x`, `o-series`), verificado contra la API:

1. Sólo admite `none | low | medium | high | xhigh`. Otro valor (p. ej. `max`)
   devuelve **400 y tumba el chat entero**. El backend valida y degrada a
   `none` en vez de propagar el fallo.
2. **Con `tools` sólo admite `none`.** Por eso las rondas de tool-calling van
   siempre con `none` y el `OPENAI_REASONING_EFFORT` configurado se reserva
   para la ronda final de redacción, que va sin herramientas.

Los modelos clásicos (`gpt-4o-mini`) no aceptan el parámetro: deja la variable
vacía. `OpenAIProvider` también adapta `max_tokens` → `max_completion_tokens` y
omite `temperature`, que los de razonamiento rechazan.

### Fuentes de contenido: nativas + MCP

El contenido sale de `wol.jw.org` por dos vías **independientes**:

| Vía | Idioma | Disponibilidad | Aporta |
|-----|--------|----------------|--------|
| Nativa (Python, `services/jw/`, `services/references/`) | Español | Siempre que haya red | Texto bíblico, búsqueda en la biblioteca, artículos, texto del día |
| MCP (`jw-mcp`, subprocess Node) | Inglés | Si el binario está instalado | Notas de estudio, guía de actividades, subtítulos de vídeo |

Las nativas son el suelo garantizado: si el MCP no arranca, el chat pierde
calidad pero **sigue funcionando y respondiendo en español**. Antes dependía
por completo del MCP, y en el contenedor de producción —donde no estaba
instalado— se quedaba sin fuentes y no podía responder nada.

## Esquema de Base de Datos Local

El frontend usa SQLite WASM (sql.js) con persistencia en IndexedDB.

### Tablas

| Tabla | Propósito |
|-------|-----------|
| `documents` | Documentos estudiados (cache de metadatos) |
| `blocks` | Bloques de contenido (para reabrir rápido) |
| `user_marks` | Subrayados multi-color con offsets |
| `notes` | Notas enriquecidas (HTML/Markdown) |
| `tags` | Etiquetas (UNIQUE por nombre) |
| `note_tags` | Relación N:M notas ↔ tags |
| `favorites` | Referencias marcadas como favoritas |
| `history` | Historial de navegación persistente |
| `notes_fts` | Tabla virtual FTS5 para búsqueda semántica |
| `schema_version` | Versionado para migraciones |

### Búsqueda Semántica (FTS5)

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, content, selected_text,
    tokenize = 'unicode61 remove_diacritics 2'
);
```

- Tokenizer `unicode61` con `remove_diacritics 2` maneja español.
- Ranking con `bm25()` (menor score = más relevante).
- Snippets con `snippet()`; el resaltado usa delimitadores de control (no HTML)
  que la UI convierte en elementos `<mark>` de React (sin `dangerouslySetInnerHTML`).
- Triggers sincronizan FTS automáticamente con `notes`.

## Mapeo a userData.db (.jwlibrary)

### Esquema de userData.db (app oficial)

| Tabla | Campos clave |
|-------|-------------|
| `UserMark` | UserMarkId, DocumentId, BlockIndex, Color (1-9), UserMarkGuid |
| `BlockRange` | BlockRangeId, UserMarkId, StartToken, EndToken, TokenCount |
| `Note` | NoteId, UserMarkId, DocumentId, Title, Content, LastModified |
| `Tag` | TagId, Name (UNIQUE), Color |
| `NoteTag` | NoteTagId, NoteId, TagId |
| `Bookmark` | BookmarkId, DocumentId, BlockIndex |

### Mapeo de modelos

| Nuestro modelo | Tabla userData.db | Transformación |
|----------------|-------------------|----------------|
| `user_marks.color` ("yellow") | `UserMark.Color` (1-9) | Mapa de colores |
| `user_marks.start_offset/end_offset` | `BlockRange.StartToken/EndToken` | Cálculo de tokens (palabras) |
| `notes.content` | `Note.Content` | Directo |
| `tags.name` | `Tag.Name` | Directo (INSERT OR IGNORE) |

### Cálculo de tokens

La app oficial usa "tokens" (palabras) como unidad de posición. El frontend calcula
los `start_token`/`end_token`/`token_count` y los envía en cada `RangeExportDTO`; el
`SchemaMapper` los inserta directamente en `BlockRange`.

### Seguridad de inyección SQL

- **Cero concatenación**: todas las sentencias usan parámetros `?`.
- **Transacción atómica**: si una sentencia falla, rollback completo.
- **Path traversal protection**: validación de nombres en el ZIP.
- **Límite de tamaño**: 100MB máximo para evitar zip bombs.
- **Solo INSERT**: nunca UPDATE/DELETE datos existentes del usuario.

## Despliegue

### Frontend (estático)

```bash
cd frontend
pnpm build
# dist/ contiene los archivos estáticos
# Servir con nginx, Vercel, Netlify, etc.
```

### Backend (Docker)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/ .
RUN pip install -r requirements.txt
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Variables de entorno de producción

| Variable | Default | Descripción |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | API key de OpenAI. Sin ella, el análisis usa el proveedor mock |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo a usar |
| `OPENAI_MAX_TOKENS` | `2000` | Tope de tokens de respuesta |
| `OPENAI_REASONING_EFFORT` | `none` | `none\|low\|medium\|high\|xhigh`. Vacío en modelos clásicos |
| `JW_MCP_PATH` | `jw-mcp` | Ejecutable del MCP. Si la ruta absoluta no existe, cae al binario del `PATH` |
| `VITE_AI_API_BASE` | origen de la página | URL del backend (en producción se sirve co-locado) |

En producción, el `Dockerfile` instala Node + `jw-mcp` y fija
`JW_MCP_PATH=jw-mcp`. Ojo: una variable definida en el servicio (Railway,
etc.) **gana** sobre el `ENV` del Dockerfile.

## Responsive

Tres modos, no dos:

| Ancho | Layout | Navegación |
|-------|--------|------------|
| `<768px` | Lector a pantalla completa | Barra inferior de 5 destinos + bottom sheet arrastrable |
| `768–1149px` | Split 65/35 | Pestañas con scroll horizontal |
| `≥1150px` | Split 60/40 | Pestañas con scroll horizontal |

Detalles que importan: `viewport-fit=cover` + `env(safe-area-inset-*)` para el
notch y la barra gestual, objetivos táctiles de 44px, tipografía fluida con
`clamp()` (nunca por debajo de 16px en campos, para que iOS no haga zoom), y
`prefers-reduced-motion` anulando **duración y retardo** de las animaciones.

## Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `⌘K` / `Ctrl+K` | Abrir búsqueda interna |
| `←` / `→` | Capítulo anterior / siguiente (leyendo la Biblia) |
| `Esc` | Cerrar menú contextual / búsqueda / panel |
| `⌘+Enter` | Guardar nota (en editor) |

## Licencia

Proyecto privado. Todos los derechos reservados.
