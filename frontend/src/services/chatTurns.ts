/**
 * chatTurns — los turnos vivos, uno por conversación.
 *
 * Antes esto era una sola variable de módulo en `useChat` (`activeTurn`), y esa
 * variable era el techo de la app: abrir otra conversación mientras la IA
 * escribía dejaba el turno anterior sin dueño —nadie sabía ya a qué `fetch`
 * pertenecía el botón de "Detener"— y cancelar en la nueva mataba el stream de
 * la vieja. Con un mapa por `conversationId`, cada turno se cancela, se
 * consulta y se cierra por su cuenta, y dos conversaciones pueden estar
 * generando a la vez.
 *
 * Vive fuera de `useChat` y fuera del store por una razón concreta: el store
 * necesita cortar el turno de una conversación al cerrarla o al borrarla, y
 * `useChat` importa el store. Con el registro aquí, la dependencia va en una
 * sola dirección (store → chatTurns, useChat → chatTurns) y no hay ciclo.
 *
 * Ojo con lo que este módulo NO hace: no toca el estado de la interfaz. Abortar
 * el `fetch` hace saltar el `catch` de quien lo abrió, y es ese `catch` el que
 * cierra el turno en el store y guarda el parcial. Si aquí también lo
 * cerráramos, el parcial se guardaría dos veces.
 */

import { cancelJob } from "@/services/researchClient";

export interface ActiveTurn {
  controller: AbortController;
  /** Investigación profunda: hay que cancelarla también en el servidor. */
  jobId: string | null;
  conversationId: string;
}

const turns = new Map<string, ActiveTurn>();

/**
 * Registra el turno de una conversación y devuelve su ficha.
 *
 * Si ya había uno (un reintento inmediato, o el relevo del chat normal al
 * seguimiento de una investigación profunda), el nuevo lo sustituye sin
 * abortarlo: el relevo es deliberado y el anterior ya se está cerrando solo.
 */
export function trackTurn(
  conversationId: string,
  controller: AbortController,
  jobId: string | null = null,
): ActiveTurn {
  const turn: ActiveTurn = { controller, jobId, conversationId };
  turns.set(conversationId, turn);
  return turn;
}

/**
 * Da por terminado el turno, pero solo si sigue siendo el mismo `controller`.
 *
 * La comprobación no es paranoia: en investigación profunda el turno de chat
 * termina y `trackResearchJob` ya ha registrado el suyo con el mismo
 * `conversationId`. Sin comparar, el `finally` del primero borraría el
 * seguimiento del segundo y "Detener" dejaría al servidor trabajando.
 */
export function releaseTurn(
  conversationId: string,
  controller: AbortController,
): void {
  if (turns.get(conversationId)?.controller === controller) {
    turns.delete(conversationId);
  }
}

/**
 * Corta el turno de una conversación, en el cliente y —si es profundo— también
 * en el servidor. Devuelve la ficha del turno cortado, o `undefined` si no
 * había ninguno.
 */
export function stopTurn(conversationId: string): ActiveTurn | undefined {
  const turn = turns.get(conversationId);
  if (!turn) return undefined;
  turns.delete(conversationId);
  turn.controller.abort();
  // El trabajo profundo vive en el backend: cerrar el SSE no lo para. Sin esta
  // llamada, "Detener" dejaba al servidor quemando hasta cinco minutos de
  // llamadas al modelo por una respuesta que ya nadie iba a leer.
  if (turn.jobId) void cancelJob(turn.jobId);
  return turn;
}
