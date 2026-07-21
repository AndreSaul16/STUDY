# Stage 1 — Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

RUN npm install -g pnpm@11

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install

COPY frontend/ ./
ENV VITE_AI_API_BASE=""
RUN pnpm build

# Stage 2 — Backend + serve frontend
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/

COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8080

CMD ["sh", "-c", "cd /app/backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
