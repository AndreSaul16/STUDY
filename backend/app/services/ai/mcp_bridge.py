"""
MCP Bridge — puente Python para comunicarse con el servidor MCP jw-mcp via stdio.

Ejecuta jw-mcp como subprocess y se comunica via JSON-RPC 2.0 sobre stdio.
Expone las herramientas del MCP (get_verse_with_study, getWatchtowerContent, etc.)
al chat service para que el LLM pueda llamarlas.
"""

import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, Optional
from queue import Queue, Empty


class MCPBridge:
    """Puente para comunicarse con jw-mcp via stdio."""

    def __init__(self, jw_mcp_path: str = "jw-mcp"):
        self.jw_mcp_path = jw_mcp_path
        self.process: Optional[subprocess.Popen] = None
        self.request_id = 0
        self.responses: Dict[int, Queue] = {}
        self.lock = threading.Lock()
        self.reader_thread: Optional[threading.Thread] = None

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

    def stop(self) -> None:
        """Detiene el subprocess jw-mcp."""
        if self.process is not None:
            self.process.terminate()
            self.process.wait(timeout=5)
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
            response = self.responses[request_id].get(timeout=timeout)
            del self.responses[request_id]
            return response
        except Empty:
            raise TimeoutError(f"MCP request {request_id} timed out")

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
    """Obtiene el singleton del MCP bridge."""
    global _bridge
    if _bridge is None:
        _bridge = MCPBridge()
        _bridge.initialize()
    return _bridge
