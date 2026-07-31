import { chromium, type FullConfig } from "@playwright/test";
// @ts-expect-error — .mjs sin tipos, a propósito: es un servidor de 100 líneas
// que también se puede lanzar suelto con `node e2e/mock-server.mjs`.
import { startMockServer } from "./mock-server.mjs";

/**
 * Calienta el servidor de desarrollo antes de que empiecen los trabajadores.
 *
 * `vite dev` transforma los módulos BAJO DEMANDA: la primera carga de la app
 * son ~400 peticiones que el servidor resuelve de una en una. Si varios
 * trabajadores llegan a la vez con el servidor frío, algunas de esas peticiones
 * se quedan sin respuesta a tiempo, la app no llega a montar y el test falla en
 * `abrirApp` por algo que no tiene que ver con el código.
 *
 * Una carga completa previa deja el grafo transformado y en caché, y a partir
 * de ahí todos los trabajadores encuentran el servidor caliente. Medido: sin
 * esto, ~1 de cada 3 ejecuciones completas se llevaba por delante algún test.
 */
async function warmUp(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: "networkidle", timeout: 90_000 });
  } catch {
    // Si el calentamiento falla, no se tumba la suite: los tests tienen su
    // propio reintento. Solo se pierde la ventaja de arrancar en caliente.
  } finally {
    await browser.close();
  }
}

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
export default async function globalSetup(config: FullConfig) {
  const stop = (await startMockServer()) as () => Promise<void>;

  const baseURL = config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:5173";
  await warmUp(baseURL);

  return async () => {
    await stop();
  };
}
