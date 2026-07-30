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
│       │   │   ├── chat_service.py     # Chat: bucle de tools + SSE
│       │   │   ├── style_guide.py      # Bloques del system prompt (VOICE_GUIDE)
│       │   │   ├── chat_modes.py       # 5 modos de redacción
│       │   │   ├── source_tracker.py   # Fuentes consultadas → chips de la UI
│       │   │   ├── research_policy.py  # Huecos de investigación + presupuesto
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
│           ├── chat_router.py        # POST /api/chat/stream, GET /api/chat/modes
│           └── interop_router.py     # POST /api/interop/import|export
│
└── frontend/                        # React 19 + Vite + Tailwind 4
    └── src/
        ├── App.tsx                  # Root (init DB + theme + atajos)
        ├── types/
        │   ├── domain.ts            # Article, Annotation, APP_VIEWS, RESEARCH_TABS
        │   ├── reference.ts         # Reference, ReferenceType, parsers/resolvers
        │   ├── chat.ts              # ChatSource, ChatUiMessage, ChatMode
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
        │   └── repositories/        # DAOs: notes, marks, tags, history, search,
        │                            #       favorites, conversations
        ├── store/                   # Zustand stores
        │   ├── uiStore.ts           # Theme, view, tabs, sheet, search
        │   ├── chatStore.ts         # Conversación activa + historial (sin persist)
        │   ├── readerStore.ts       # Artículo + anotaciones
        │   ├── referenceStore.ts    # Referencia activa + historial
        │   └── aiStore.ts           # Stream state + results por skill
        ├── hooks/
        │   ├── useTextSelection.ts  # Selección de texto con offsets
        │   ├── useReferenceEngine.ts # Puente engine ↔ UI
        │   ├── useAIStream.ts       # fetch + ReadableStream SSE parser
        │   ├── useChapterSearch.ts  # Ctrl+F interno
        │   ├── useChat.ts           # Stream SSE del chat → chatStore
        │   ├── useStickToBottom.ts  # Auto-scroll que no secuestra al usuario
        │   ├── useVisualViewport.ts # --kb-inset: teclado móvil
        │   ├── useCopyToClipboard.ts # Copiar con fallback a execCommand
        │   ├── useMediaQuery.ts     # Responsive
        │   ├── useDatabase.ts       # Init SQLite WASM
        │   └── useVirtualList.ts    # Virtualización sin deps
        ├── services/
        │   ├── chatClient.ts        # Modos + recorte del historial al contrato
        │   └── jwlibraryClient.ts   # Cliente HTTP interop
        ├── data/                    # Mock data
        ├── components/
        │   ├── atoms/               # Button, Icons, CopyButton, Markdown(WithRefs)…
        │   ├── molecules/           # ChatComposer, ChatMessage, ModePicker, SourceChips,
        │   │                        # FollowUpChips, BottomNav, ContextMenu, TabBar…
        │   ├── organisms/           # ChatScreen, ConversationsDrawer, MoreScreen,
        │   │                        # ReaderPanel, ResearchPanel, AIPanel…
        │   └── templates/           # AppShell (raíz) + SplitLayout (vista de lectura)
        └── utils/                   # cn, chatSegments, plainText, linkifyReferences
```

## Navegación: el chat es el producto

`AppShell` es la raíz. La app arranca en el **chat**, no en el lector: el chat
estaba antes en la pestaña novena de diez, dentro de un bottom sheet, dentro
del lector — tres niveles de profundidad para lo que más se usa.

| Vista (`APP_VIEWS`) | Móvil (<768px) | Escritorio |
|---|---|---|
| `chat` (por defecto) | `ChatScreen` a pantalla completa | `ChatScreen` 55 % \| `ResearchPanel` 45 % |
| `bible` | `BiblePanel` a pantalla completa | (cae a la vista de lectura) |
| `read` | `ReaderPanel` + bottom sheet | `SplitLayout` (60/40 o 65/35), reutilizado tal cual |
| `more` | `MoreScreen` (Notas, Anotaciones, Favoritos, Biblioteca, Análisis, Sync, Ajustes) | (cae a la vista de lectura) |

En móvil solo se monta la vista activa: en el chat no se paga el render del
lector ni su `useTextSelection`. La vista se persiste junto al tema, así que la
app reabre donde estaba.

`RESEARCH_TABS` no cambia: el panel de investigación sigue sabiendo renderizar
sus diez pestañas. Lo que cambia es que la `TabBar` lista cinco por defecto y
al resto se llega desde "Más".

## El chat

### Modos de redacción

`GET /api/chat/modes` devuelve el catálogo (sin los prompts, que son internos).
El endpoint **no** depende del proveedor de IA: responde 200 aunque falte
`OPENAI_API_KEY`, para que el selector se pueda pintar siempre.

| id | Para qué | Longitud objetivo |
|---|---|---|
| `analisis` (default) | Respuesta de estudio con su fuente en cada afirmación | — |
| `comentario` | Comentario de reunión listo para leer en voz alta | 60-80 palabras |
| `ilustracion` | Ilustración moderna atada a un pasaje | 120-200 palabras |
| `discurso` | Guion con introducción, pasos y conclusión | 400-700 palabras |
| `presentacion` | Programa de acto y oración | — |

El system prompt se compone por bloques (`style_guide.py`): identidad,
política de investigación, idioma, **voz del usuario**, plantilla del modo,
contrato de citas y catálogo de herramientas. `VOICE_GUIDE` se inyecta en
todos los modos: la IA de esta app no es un asistente genérico, escribe como
escribe el usuario.

### Calidad de la investigación

Un prompt es una petición, no una garantía. Después de las rondas de
herramientas, `research_policy.py` comprueba huecos concretos y fuerza **una**
ronda de cierre si los encuentra:

- no se consultó ninguna fuente;
- se buscó pero no se abrió ningún artículo (un fragmento de búsqueda no basta);
- el modo es de púlpito (`comentario`, `ilustracion`, `discurso`) y no se leyó
  el texto bíblico literal, sin el cual no se puede entrecomillar la expresión
  clave.

Además hay caché de herramientas por petición (el modelo reabre el mismo
`doc_id` en rondas distintas y cada scrape cuesta ~20 s) y un presupuesto de
tiempo, porque los proxies cortan un SSE que pasa mucho rato sin emitir bytes.

### Eventos SSE de `POST /api/chat/stream`

```
event: tool_call     {"name":"buscar_en_biblioteca","arguments":{…}}
event: tool_result   {"name":"buscar_en_biblioteca","summary":"6 resultados"}
event: sources       {"items":[{"kind":"article","label":"…","citation":"…","doc_id":123}]}
event: metadata      {"tool_calls":4,"model":"…","mode":"comentario"}
event: token         {"text":"…"}
event: suggestions   {"items":["…","…","…"]}
event: done          {"total_tokens":8123,"elapsed_ms":41210}
event: error         {"message":"…"}
: ping                                            (keepalive, se ignora)
```

`mode` y `conversation_id` del request son **opcionales**, y los eventos nuevos
son aditivos: un cliente antiguo los ignora y sigue funcionando. Por eso el
backend se puede desplegar sin reconstruir el `frontend/dist`.

`mode` no se valida con un patrón estricto a propósito: un id desconocido
degrada al modo por defecto en vez de devolver 422.

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
| `conversations` | Conversaciones del chat (título, modo, fijada) |
| `chat_messages` | Mensajes con sus fuentes, herramientas y sugerencias (JSON) |
| `notes_fts` | Tabla virtual FTS5 para búsqueda semántica |
| `schema_version` | Versionado para migraciones (v3) |

**El historial del chat vive en el cliente**, no en el backend. La app no tiene
autenticación (un historial en Railway sería compartido por quien abriera la
URL) y el contenedor tiene filesystem efímero (se borraría en cada deploy).

`migrateChatTables` es aditiva e idempotente: solo crea tablas e índices, sin
`DROP` ni `ALTER` destructivos, y se aplica igual sobre una base v2 existente.
Las tablas del chat **no usan FTS5** (sql.js estándar no lo trae): la búsqueda
de conversaciones va con `LIKE`, el mismo fallback que ya usa `searchRepository`.

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
| `CHAT_MAX_TOOL_ROUNDS` | `5` | Rondas máximas de tool-calling (1-10). Más rondas = mejor documentado pero más lento y más caro |
| `CHAT_RESEARCH_BUDGET_SECONDS` | `75` | Segundos de investigación antes de cortar y redactar (10-600). Existe porque los proxies cortan un SSE inactivo |
| `CHAT_FOLLOWUPS` | `1` | Generar las 3 sugerencias con una llamada corta extra (~200 tokens). Con `0` se usan las estáticas de cada modo |
| `JW_MCP_PATH` | `jw-mcp` | Ejecutable del MCP. Si la ruta absoluta no existe, cae al binario del `PATH` |
| `VITE_AI_API_BASE` | origen de la página | URL del backend (en producción se sirve co-locado) |

Las tres `CHAT_*` degradan a su default si traen basura o quedan fuera de
rango: una variable mal escrita en el panel de Railway no puede dejar el chat
sin servicio.

En producción, el `Dockerfile` instala Node + `jw-mcp` y fija
`JW_MCP_PATH=jw-mcp`. Ojo: una variable definida en el servicio (Railway,
etc.) **gana** sobre el `ENV` del Dockerfile.

**`frontend/dist` está commiteado y es lo que sirve el backend.** Los cambios
de frontend no llegan a producción hasta que se reconstruya (`pnpm build`) y se
commitee `dist/`. Es un paso deliberado: los cambios de backend son
retrocompatibles con el `dist` anterior.

## Responsive

Tres modos, no dos:

| Ancho | Layout | Navegación |
|-------|--------|------------|
| `<768px` | Una vista a la vez (`AppShell`) | `BottomNav` de 4 destinos + bottom sheet arrastrable en la lectura |
| `768–1149px` | Chat 55/45 · lectura 65/35 | Pestañas (5 primarias) |
| `≥1150px` | Chat 55/45 · lectura 60/40 | Pestañas (5 primarias) |

Detalles que importan: `viewport-fit=cover` + `env(safe-area-inset-*)` para el
notch y la barra gestual, objetivos táctiles de 44px, tipografía fluida con
`clamp()` (nunca por debajo de 16px en campos, para que iOS no haga zoom), y
`prefers-reduced-motion` anulando **duración y retardo** de las animaciones.

Dos detalles del chat en móvil que no son cosméticos:

- **El teclado.** `100dvh` no se entera de que el teclado tapa medio viewport.
  `useVisualViewport` publica `--kb-inset` y el composer se sube con él; la
  `BottomNav` se esconde para no robar 56 px mientras se escribe.
- **El auto-scroll.** Antes se hacía `scrollTop = scrollHeight` en cada token:
  era imposible releer hacia arriba durante los 30-60 s que tarda la respuesta.
  Ahora solo se pega al fondo si el usuario ya estaba abajo, y si no aparece un
  botón "Ir al final".
- **El composer no se deshabilita** mientras la IA responde: deshabilitarlo
  cierra el teclado en iOS y hace perder el foco.

## Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `⌘K` / `Ctrl+K` | Abrir búsqueda interna |
| `←` / `→` | Capítulo anterior / siguiente (leyendo la Biblia) |
| `Esc` | Cerrar menú contextual / búsqueda / panel |
| `⌘+Enter` | Guardar nota (en editor) |

## Licencia

Proyecto privado. Todos los derechos reservados.
