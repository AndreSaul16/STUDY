// @ts-expect-error — .mjs sin tipos, a propósito: es un servidor de 100 líneas
// que también se puede lanzar suelto con `node e2e/mock-server.mjs`.
import { startMockServer } from "./mock-server.mjs";

/**
 * Arranca el servidor SSE de pruebas DENTRO del proceso de Playwright.
 *
 * Se hizo así después de intentarlo como un `webServer` más: dos servidores
 * arrancando en paralelo (uno de ellos vía `pnpm`) se atascaban en máquinas
 * lentas y la suite se quedaba colgada antes del primer test, sin decir nada.
 * En proceso arranca en milisegundos y muere con la suite.
 *
 * Playwright llama a la función devuelta como teardown global.
 */
export default async function globalSetup() {
  const stop = (await startMockServer()) as () => Promise<void>;
  return async () => {
    await stop();
  };
}
