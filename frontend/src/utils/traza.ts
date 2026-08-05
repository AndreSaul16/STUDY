/**
 * traza — registro de diagnóstico del chat, legible con varios turnos a la vez.
 *
 * Por qué existe: con dos conversaciones generando al mismo tiempo, los fallos
 * dejaron de ser reproducibles a ojo. "Se queda en blanco" puede ser un turno
 * que muere, dos que se pisan en el store o un stream que se corta, y sin ver
 * el orden real de los eventos no hay forma de distinguirlos.
 *
 * Dos decisiones que hacen que esto sirva de algo:
 *
 *   * **Cada línea lleva su conversación y el tiempo desde que arrancó la
 *     app.** Sin el id, dos turnos entrelazados son un galimatías; sin el
 *     tiempo, no se ve cuál llegó antes, que es justo lo que hay que saber en
 *     una carrera.
 *   * **Se puede apagar sin tocar código.** `localStorage.setItem("study-log",
 *     "0")` y desaparece. Viene ENCENDIDO a propósito mientras estemos
 *     persiguiendo esto: un registro que hay que activar es un registro que no
 *     está cuando pasa el fallo raro.
 */

const CLAVE = "study-log";
const inicio = Date.now();

function activo(): boolean {
  try {
    // Encendido salvo que se apague explícitamente.
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    // Safari privado lanza al leer localStorage. Ante la duda, registrar.
    return true;
  }
}

/** Los ids son largos; para leer el registro basta con el final. */
function corto(conversationId?: string | null): string {
  if (!conversationId) return "—";
  return conversationId.length > 8 ? `…${conversationId.slice(-6)}` : conversationId;
}

function marca(): string {
  return `${((Date.now() - inicio) / 1000).toFixed(2)}s`;
}

/**
 * Una línea de traza.
 *
 * `datos` va como objeto y no interpolado en el texto: la consola lo deja
 * plegado y se puede inspeccionar, en vez de convertirlo en una cadena
 * ilegible de 300 caracteres.
 */
export function traza(
  ambito: string,
  mensaje: string,
  conversationId?: string | null,
  datos?: unknown,
): void {
  if (!activo()) return;
  const cabecera = `%c[${marca()}] ${ambito} ${corto(conversationId)}`;
  const estilo = "color:#b45309;font-weight:600";
  if (datos === undefined) console.log(cabecera, estilo, mensaje);
  else console.log(cabecera, estilo, mensaje, datos);
}

/** Un fallo. Va por `console.error` para que se filtre por severidad. */
export function trazaError(
  ambito: string,
  mensaje: string,
  conversationId?: string | null,
  datos?: unknown,
): void {
  if (!activo()) return;
  console.error(`[${marca()}] ${ambito} ${corto(conversationId)}`, mensaje, datos ?? "");
}
