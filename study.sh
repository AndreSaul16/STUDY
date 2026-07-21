#!/usr/bin/env bash
#
# study.sh — arranca/para/reinicia la app Study (backend FastAPI + frontend Vite)
# como servicios de usuario de systemd, para que SOBREVIVAN al cierre de la terminal.
#
# Uso:
#   ./study.sh start   [backend|frontend|all]   (por defecto: all)
#   ./study.sh stop    [backend|frontend|all]
#   ./study.sh restart [backend|frontend|all]    # úsalo tras cambiar código del backend
#   ./study.sh status
#   ./study.sh logs    [backend|frontend]        # sigue los logs en vivo (Ctrl+C para salir)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_UNIT="study-backend"
FRONTEND_UNIT="study-frontend"
PORT_BACKEND=8000

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

start_backend() {
  systemctl --user reset-failed "$BACKEND_UNIT.service" 2>/dev/null || true
  systemctl --user stop "$BACKEND_UNIT.service" 2>/dev/null || true
  log "arrancando backend (uvicorn --reload) en :$PORT_BACKEND"
  systemd-run --user --unit="$BACKEND_UNIT" \
    --working-directory="$BACKEND_DIR" \
    "$BACKEND_DIR/.venv/bin/uvicorn" app.main:app --port "$PORT_BACKEND" --reload >/dev/null
}

start_frontend() {
  systemctl --user reset-failed "$FRONTEND_UNIT.service" 2>/dev/null || true
  systemctl --user stop "$FRONTEND_UNIT.service" 2>/dev/null || true
  log "arrancando frontend (vite dev)"
  # bash -lc para cargar el PATH (pnpm/node) del perfil de usuario.
  systemd-run --user --unit="$FRONTEND_UNIT" \
    --working-directory="$FRONTEND_DIR" \
    bash -lc "pnpm dev --host" >/dev/null
}

stop_unit() {
  local unit="$1"
  systemctl --user stop "$unit.service" 2>/dev/null && log "detenido $unit" || log "$unit no estaba corriendo"
  systemctl --user reset-failed "$unit.service" 2>/dev/null || true
}

status() {
  for u in "$BACKEND_UNIT" "$FRONTEND_UNIT"; do
    state="$(systemctl --user is-active "$u.service" 2>/dev/null || true)"
    printf '  %-16s %s\n' "$u" "$state"
  done
  echo "  ---"
  if curl -sf -m 3 "http://localhost:$PORT_BACKEND/health" >/dev/null 2>&1; then
    echo "  backend  http://localhost:$PORT_BACKEND  → OK (/health responde)"
  else
    echo "  backend  http://localhost:$PORT_BACKEND  → NO responde"
  fi
}

target="${2:-all}"
case "${1:-}" in
  start)
    case "$target" in
      backend) start_backend ;;
      frontend) start_frontend ;;
      all) start_backend; start_frontend ;;
      *) err "target inválido: $target"; exit 1 ;;
    esac
    sleep 3; status
    echo
    log "Abre la app en el navegador (Vite: normalmente http://localhost:5173)"
    ;;
  stop)
    case "$target" in
      backend) stop_unit "$BACKEND_UNIT" ;;
      frontend) stop_unit "$FRONTEND_UNIT" ;;
      all) stop_unit "$BACKEND_UNIT"; stop_unit "$FRONTEND_UNIT" ;;
      *) err "target inválido: $target"; exit 1 ;;
    esac
    ;;
  restart)
    case "$target" in
      backend) start_backend ;;
      frontend) start_frontend ;;
      all) start_backend; start_frontend ;;
      *) err "target inválido: $target"; exit 1 ;;
    esac
    sleep 3; status
    ;;
  logs)
    case "$target" in
      backend) journalctl --user -u "$BACKEND_UNIT.service" -f ;;
      frontend) journalctl --user -u "$FRONTEND_UNIT.service" -f ;;
      *) err "indica backend o frontend: ./study.sh logs backend"; exit 1 ;;
    esac
    ;;
  status) status ;;
  *)
    echo "Uso: ./study.sh {start|stop|restart|status|logs} [backend|frontend|all]"
    exit 1
    ;;
esac
