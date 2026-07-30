/**
 * Utilidades de parsing SSE (Server-Sent Events) compartidas.
 *
 * Tolerante a `\r\n` y a múltiples líneas `data:` por evento (que según el
 * spec deben concatenarse con `\n`).
 */

export interface ParsedSSEEvent {
  event: string;
  data: Record<string, unknown>;
  /**
   * Número del evento (línea `id:`), si el emisor lo manda.
   *
   * Solo lo usa la investigación profunda, que numera sus eventos para poder
   * reanudar con `Last-Event-ID` tras un túnel o un cambio de red. El chat
   * normal no lo emite y aquí queda `undefined`.
   */
  id?: number;
}

/**
 * Parsea un bloque de evento SSE crudo.
 * Devuelve null si no hay tipo de evento, no hay data, o el JSON es inválido.
 */
export function parseSSEEvent(raw: string): ParsedSSEEvent | null {
  const lines = raw.split(/\r?\n/);
  let eventType = "";
  let id: number | undefined;
  const dataParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    } else if (line.startsWith("id:")) {
      const parsed = Number.parseInt(line.slice(3).trim(), 10);
      if (Number.isFinite(parsed)) id = parsed;
    }
  }

  if (!eventType || dataParts.length === 0) return null;

  try {
    return {
      event: eventType,
      data: JSON.parse(dataParts.join("\n")) as Record<string, unknown>,
      ...(id === undefined ? {} : { id }),
    };
  } catch {
    return null;
  }
}

/**
 * Divide un buffer SSE en bloques de evento completos + el resto incompleto.
 * Los eventos se separan por una línea en blanco (`\n\n` o `\r\n\r\n`).
 */
export function splitSSEEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { events: parts, rest };
}
