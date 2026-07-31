/**
 * Servidor SSE de pruebas.
 *
 * Existe por una limitación concreta de Playwright: `route.fulfill()` entrega
 * el cuerpo entero de golpe, así que con él es imposible probar nada que
 * dependa de que el stream siga ABIERTO — el rastro de herramientas mientras
 * la IA investiga, o cancelar a mitad de una respuesta y quedarse con el
 * parcial. Ese es justamente el comportamiento que más se rompe.
 *
 * Aquí los eventos salen con su retardo real y el stream se queda abierto
 * hasta que el escenario termina (o hasta que el cliente aborta). Sigue sin
 * haber red: es un servidor local que vive y muere con la suite.
 *
 * Se arranca desde `globalSetup` (dentro del propio proceso de Playwright) y
 * NO como un `webServer` más: un hijo menos que esperar, y en máquinas lentas
 * el arranque de dos servidores en paralelo se atascaba.
 *
 * El backend de la app NO se usa: esto sustituye a `/api/chat/stream` y nada
 * más.
 */

import { createServer } from "node:http";

export const MOCK_SSE_PORT = Number(process.env.MOCK_SSE_PORT ?? 5174);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const sse = (event, data) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Igual, pero numerado: la investigación profunda los usa para reanudar. */
const sseId = (id, event, data) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Escenarios. Cada uno es una lista de `[retardo_ms, trozo]`.
 *
 * Los que acaban con un retardo enorme dejan el stream abierto a propósito:
 * así el cliente sigue en "isStreaming" y se puede probar el rastro y la
 * cancelación. El proceso muere con la suite, no quedan sockets colgando.
 */
const SCENARIOS = {
  // Herramientas anunciadas y el stream sigue abierto: es el rato en el que
  // la app parece colgada si el rastro no funciona.
  herramientas: [
    [100, sse("tool_call", { name: "buscar_en_biblioteca", arguments: { consulta: "aguante" } })],
    [200, sse("tool_result", { name: "buscar_en_biblioteca", summary: "6 resultados" })],
    [200, sse("tool_call", { name: "abrir_documento", arguments: { doc_id: 2015401 } })],
    [60_000, sse("done", { total_tokens: 0, elapsed_ms: 60000 })],
  ],

  // Empieza a redactar y no termina: para cancelar a mitad.
  parcial: [
    [100, sse("token", { text: "Empiezo a redactar y" })],
    [60_000, sse("done", { total_tokens: 0, elapsed_ms: 60000 })],
  ],

  // El stream de una investigación profunda: plan, progreso y algo de texto,
  // y el stream se queda abierto. Es el rato —minutos— en el que "Detener"
  // tiene que cancelar el trabajo en el servidor de verdad.
  investigacion: [
    [
      100,
      sseId(1, "plan", {
        items: [
          { id: 1, question: "Qué dice la Biblia sobre el aguante" },
          { id: 2, question: "Qué dicen las publicaciones" },
        ],
        budget_seconds: 150,
      }),
    ],
    [
      100,
      sseId(2, "progress", {
        step: 1,
        total: 2,
        label: "Qué dice la Biblia sobre el aguante",
        docs: 1,
        elapsed_ms: 1200,
      }),
    ],
    [100, sseId(3, "token", { text: "Voy redactando el informe y" })],
    [60_000, sseId(4, "done", { total_tokens: 0, elapsed_ms: 60000 })],
  ],
};

export function createMockServer() {
  return createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_SSE_PORT}`);
    const scenario = SCENARIOS[url.searchParams.get("scenario") ?? ""] ?? [];

    res.writeHead(200, {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let cancelled = false;
    const timers = [];
    req.on("close", () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    });

    (async () => {
      for (const [delay, chunk] of scenario) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          timers.push(timer);
        });
        if (cancelled || res.writableEnded) return;
        res.write(chunk);
      }
      if (!cancelled) res.end();
    })();
  });
}

/** Arranca el servidor y devuelve cómo pararlo. */
export function startMockServer() {
  const server = createMockServer();
  // `unref` para que un socket abierto no impida salir al proceso.
  return new Promise((resolve) => {
    server.listen(MOCK_SSE_PORT, "127.0.0.1", () => {
      server.unref();
      resolve(() => new Promise((done) => server.close(() => done())));
    });
  });
}

// Ejecutable suelto: útil para depurar a mano con `node e2e/mock-server.mjs`.
if (process.argv[1] && process.argv[1].endsWith("mock-server.mjs")) {
  void startMockServer().then(() => {
    console.log(`mock-sse listo en http://127.0.0.1:${MOCK_SSE_PORT}`);
  });
}
