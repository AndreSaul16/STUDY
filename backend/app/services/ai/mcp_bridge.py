"""
MCP Bridge — puente Python para comunicarse con el servidor MCP jw-mcp via stdio.

Ejecuta jw-mcp como subprocess y se comunica via JSON-RPC 2.0 sobre stdio.
Expone las herramientas del MCP (get_verse_with_study, getWatchtowerContent, etc.)
al chat service para que el LLM pueda llamarlas.
"""

import json
import logging
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, Optional
from queue import Queue, Empty

logger = logging.getLogger(__name__)


def _resolve_mcp_command(configured: Optional[str]) -> str:
    """
    Elige el ejecutable de jw-mcp.

    JW_MCP_PATH puede quedar apuntando a una ruta que sólo existe en la máquina
    de desarrollo (p. ej. el shim de pnpm en WSL). Dentro del contenedor esa
    ruta no existe y el bridge moría con FileNotFoundError. Si la ruta
    configurada es absoluta y no existe, caemos al binario ``jw-mcp`` del PATH,
    que es como lo instala la imagen Docker.
    """
    candidate = (configured or "").strip() or "jw-mcp"

    if os.path.isabs(candidate) and not Path(candidate).exists():
        fallback = shutil.which("jw-mcp")
        if fallback:
            logger.warning(
                "JW_MCP_PATH=%s no existe; usando %s del PATH.", candidate, fallback
            )
            return fallback
        logger.warning("JW_MCP_PATH=%s no existe y no hay jw-mcp en el PATH.", candidate)

    return candidate


class MCPBridge:
    """Puente para comunicarse con jw-mcp via stdio."""

    def __init__(self, jw_mcp_path: Optional[str] = None):
        self.jw_mcp_path = _resolve_mcp_command(
            jw_mcp_path or os.getenv("JW_MCP_PATH")
        )
        self.process: Optional[subprocess.Popen] = None
        self.request_id = 0
        self.responses: Dict[int, Queue] = {}
        self.lock = threading.Lock()
        self.reader_thread: Optional[threading.Thread] = None
        self.stderr_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """Inicia el subprocess jw-mcp."""
        if self.process is not None:
            return

        self.process = subprocess.Popen(
            [self.jw_mcp_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Iniciar thread para leer respuestas
        self.reader_thread = threading.Thread(target=self._read_responses, daemon=True)
        self.reader_thread.start()

        # Drenar stderr para evitar bloqueo del subprocess si llena el buffer
        self.stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self.stderr_thread.start()

    def _drain_stderr(self) -> None:
        """Lee y loguea stderr del subprocess para que no bloquee su buffer."""
        if self.process is None or self.process.stderr is None:
            return
        for line in self.process.stderr:
            line = line.rstrip()
            if line:
                logger.debug("[jw-mcp stderr] %s", line)

    def stop(self) -> None:
        """Detiene el subprocess jw-mcp, con kill si no termina a tiempo."""
        if self.process is None:
            return
        try:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        finally:
            self.process = None

    def _read_responses(self) -> None:
        """Lee respuestas del stdout del MCP server."""
        if self.process is None or self.process.stdout is None:
            return

        for line in self.process.stdout:
            try:
                response = json.loads(line.strip())
                request_id = response.get("id")
                if request_id is not None and request_id in self.responses:
                    self.responses[request_id].put(response)
            except json.JSONDecodeError:
                continue

    def _send_request(self, method: str, params: Optional[Dict[str, Any]] = None) -> int:
        """Envía una petición JSON-RPC al MCP server."""
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("MCP bridge not started")

        # TODO dentro del candado, no solo el contador.
        #
        # Antes solo se protegía el `request_id++` y la escritura quedaba
        # fuera. Con un chat da igual; con dos, los dos hilos escriben a la vez
        # en la MISMA tubería y las líneas JSON-RPC se entrelazan a mitad. El
        # subproceso recibe una línea corrupta, no la puede parsear, la
        # respuesta no llega nunca y el turno se queda colgado hasta agotar los
        # 30 s de espera. Para el usuario: "si tengo más de un chat abierto,
        # fallan".
        #
        # `stdin` es una tubería de texto con búfer de línea: `write()` NO es
        # atómico entre hilos. El candado es lo único que garantiza que cada
        # petición llegue entera y en una sola línea.
        #
        # La cola de respuesta se registra también aquí dentro: si se
        # registrara después de escribir, el hilo lector podría llegar con la
        # respuesta antes de que exista dónde dejarla y la tiraría.
        with self.lock:
            self.request_id += 1
            request_id = self.request_id

            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params or {},
            }

            self.responses[request_id] = Queue()
            self.process.stdin.write(json.dumps(request) + "\n")
            self.process.stdin.flush()

        return request_id

    def _wait_response(self, request_id: int, timeout: float = 30.0) -> Dict[str, Any]:
        """Espera una respuesta del MCP server."""
        try:
            return self.responses[request_id].get(timeout=timeout)
        except Empty:
            raise TimeoutError(f"MCP request {request_id} timed out")
        finally:
            self.responses.pop(request_id, None)

    def initialize(self) -> Dict[str, Any]:
        """Inicializa la conexión MCP."""
        self.start()
        request_id = self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "study-app",
                "version": "1.0.0",
            },
        })
        return self._wait_response(request_id)

    def list_tools(self) -> list[Dict[str, Any]]:
        """Lista las herramientas disponibles del MCP."""
        request_id = self._send_request("tools/list")
        response = self._wait_response(request_id)
        return response.get("result", {}).get("tools", [])

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Llama a una herramienta del MCP."""
        request_id = self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })
        response = self._wait_response(request_id)
        return response.get("result", {})


# Singleton global
_bridge: Optional[MCPBridge] = None


def get_mcp_bridge() -> MCPBridge:
    """Obtiene el singleton del MCP bridge.

    Solo asigna el singleton tras un initialize() exitoso; si falla,
    detiene el bridge y propaga el error para permitir reintentos.
    """
    global _bridge
    if _bridge is None:
        bridge = MCPBridge()
        try:
            bridge.initialize()
        except Exception:
            bridge.stop()
            raise
        _bridge = bridge
    return _bridge


def shutdown_mcp_bridge() -> None:
    """Detiene el singleton del MCP bridge (para shutdown de la app)."""
    global _bridge
    if _bridge is not None:
        try:
            _bridge.stop()
        finally:
            _bridge = None
