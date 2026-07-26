FROM python:3.11-slim

WORKDIR /app

# Node hace falta para jw-mcp, que el backend arranca como subprocess (stdio).
# Sin él el chat sigue funcionando con las herramientas nativas en español,
# pero pierde notas de estudio, guía de actividades y subtítulos de vídeo.
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 build-essential curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g jw-mcp@1.2.0 \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY frontend/dist ./frontend/dist

# El bridge lanza este binario por nombre; npm -g lo deja en el PATH.
# Railway tiene JW_MCP_PATH apuntando a una ruta de WSL; esto es el defecto
# correcto dentro del contenedor si esa variable se retira.
ENV JW_MCP_PATH=jw-mcp

EXPOSE 8080

CMD ["sh", "-c", "cd /app/backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
