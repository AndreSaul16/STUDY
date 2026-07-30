import type { Page, Route } from "@playwright/test";

/**
 * Construcción de cuerpos SSE para los mocks.
 *
 * `route.fulfill` entrega el cuerpo entero de golpe, no troceado. Da igual: el
 * parser del cliente acumula en un búfer y parte por líneas en blanco, así que
 * el resultado es el mismo. El troceado real (un evento partido entre dos
 * `read()`) es cosa de un test unitario de `splitSSEEvents`, no de un E2E.
 */
export function sse(events: Array<[string, unknown]>): string {
  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

/** Igual, pero numerando los eventos (investigación profunda). */
export function sseNumbered(
  events: Array<[string, unknown]>,
  startId = 1,
): string {
  return events
    .map(
      ([event, data], i) =>
        `id: ${startId + i}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

export function fulfillSSE(route: Route, body: string) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "Cache-Control": "no-cache" },
    body,
  });
}

export async function mockChatStream(page: Page, body: string): Promise<void> {
  await page.route("**/api/chat/stream", (route) => fulfillSSE(route, body));
}

/**
 * El turno completo de referencia: dos rondas de herramientas, fuentes,
 * metadata, texto con una cita de bloque, sugerencias y cierre.
 *
 * La cita lleva `>` y negritas a propósito: el botón de copiar tiene que
 * entregarla limpia, y eso es lo que comprueba el spec 05.
 */
export const RESPUESTA_COMPLETA = sse([
  ["tool_call", { name: "buscar_en_biblioteca", arguments: { consulta: "aguante" } }],
  ["tool_result", { name: "buscar_en_biblioteca", summary: "6 resultados" }],
  ["tool_call", { name: "leer_pasaje_biblico", arguments: { libro: "Isaías", capitulo: 58 } }],
  ["tool_result", { name: "leer_pasaje_biblico", summary: "Isaías 58" }],
  [
    "sources",
    {
      items: [
        {
          kind: "article",
          label: "La Atalaya, 15 de mayo de 2015",
          citation: "pág. 12",
          doc_id: 2015401,
        },
        { kind: "scripture", label: "Isaías 58:12", identifier: "scripture:isaías:58:12" },
      ],
    },
  ],
  [
    "metadata",
    {
      tool_calls: 2,
      model: "gpt-5.6-luna",
      mode: "comentario",
      provider: "openai",
      effort: "alto",
      effort_applied: "high",
      source: "server",
    },
  ],
  ["token", { text: "Ese es un punto de vista excelente.\n\n" }],
  [
    "token",
    {
      text: '> **"Cuando Isaías habla de «reparadores de brechas», nos recuerda que cada esfuerzo cuenta."**\n\n',
    },
  ],
  ["token", { text: "### Por qué funciona\n\n- **Toca las emociones:** sí.\n" }],
  [
    "suggestions",
    { items: ["¿Qué dice el contexto?", "Dame una versión más corta", "¿Y para el ministerio?"] },
  ],
  ["done", { total_tokens: 1234, elapsed_ms: 4200 }],
]);

/** Turno mínimo: solo texto. Para los specs que no miran el rastro. */
export const RESPUESTA_SIMPLE = sse([
  ["token", { text: "Respuesta breve de prueba." }],
  ["done", { total_tokens: 10, elapsed_ms: 100 }],
]);
