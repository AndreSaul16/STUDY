# Stage 1 — Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY frontend/ ./
# Empty base URL → API calls use same origin (both served from same Railway domain)
ENV VITE_AI_API_BASE=""
RUN pnpm build

# Stage 2 — Backend + serve frontend
FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Railway provides PORT env var
EXPOSE 8080

CMD ["sh", "-c", "cd /app/backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
