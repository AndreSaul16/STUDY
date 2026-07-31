import { expect, type Page } from "@playwright/test";
import { mockApi } from "./api";

/**
 * Helpers de arranque.
 *
 * Cada test corre en un `BrowserContext` nuevo, así que `localStorage` e
 * `IndexedDB` empiezan vacíos. El estado previo que haga falta se inyecta con
 * `addInitScript`, ANTES de que la app lea nada.
 */

/** Estado inicial de `localStorage` para un test. */
export interface EstadoInicial {
  view?: "chat" | "read" | "bible" | "more";
  mode?: string;
  theme?: "light" | "dark";
  ai?: {
    provider: string;
    effort: string;
    byProvider: Record<string, { apiKey: string; model: string }>;
  };
}

export async function seed(page: Page, estado: EstadoInicial): Promise<void> {
  await page.addInitScript((data: EstadoInicial) => {
    if (data.view || data.theme) {
      localStorage.setItem(
        "study-ui",
        JSON.stringify({
          state: {
            view: data.view ?? "chat",
            theme: data.theme ?? "light",
            researchOpen: true,
          },
          version: 0,
        }),
      );
    }
    if (data.mode) localStorage.setItem("study-chat-mode", data.mode);
    if (data.ai) {
      localStorage.setItem(
        "study-ai-settings",
        JSON.stringify({
          version: 1,
          provider: data.ai.provider,
          effort: data.ai.effort,
          byProvider: data.ai.byProvider,
          imageModel: "",
          imageQuality: "medium",
          researchProvider: "propio",
        }),
      );
    }
  }, estado);
}

/**
 * Abre la app con los mocks puestos y espera a que sql.js esté listo.
 *
 * La espera es real y no cosmética: la base se inicializa con un WASM y hasta
 * que no termina, el composer no acepta mensajes.
 *
 * El reintento no es paranoia: `vite dev` sirve un centenar de módulos sueltos
 * y, con varios trabajadores a la vez, alguna de esas peticiones cae con
 * ERR_NETWORK_CHANGED. La app se queda a medio cargar por algo que no tiene
 * nada que ver con el código, y una recarga lo resuelve.
 */
export async function abrirApp(page: Page): Promise<void> {
  await mockApi(page);
  await page.goto("/");

  for (let intento = 0; intento < 2; intento += 1) {
    try {
      await composer(page).waitFor({ state: "visible", timeout: 8_000 });
      return;
    } catch {
      await page.reload();
    }
  }
  await expect(composer(page)).toBeVisible();
}

/** URL del servidor SSE de pruebas (ver e2e/mock-server.mjs). */
export const MOCK_SSE = "http://127.0.0.1:5174/";

/**
 * Redirige `/api/chat/stream` al servidor SSE de pruebas.
 *
 * `route.continue({ url })` en vez de `fulfill`: así el stream llega de
 * verdad, trozo a trozo y sin cerrarse, que es lo que hace falta para probar
 * el rastro de herramientas y la cancelación.
 */
export async function mockChatStreamLento(
  page: Page,
  scenario: "herramientas" | "parcial",
): Promise<void> {
  await page.route("**/api/chat/stream", (route) =>
    route.continue({ url: `${MOCK_SSE}?scenario=${scenario}` }),
  );
}

/**
 * Redirige el stream de una investigación profunda al servidor SSE de pruebas.
 *
 * Mismo motivo que `mockChatStreamLento`: el trabajo tiene que seguir vivo
 * para poder pulsar "Detener" encima.
 */
export async function mockResearchStreamLento(page: Page): Promise<void> {
  await page.route("**/api/research/stream/*", (route) =>
    route.continue({ url: `${MOCK_SSE}?scenario=investigacion` }),
  );
}

/** La caja de escribir. Es lo último que aparece: sirve de señal de "listo". */
export function composer(page: Page) {
  return page.locator("textarea").first();
}

/** Envía un mensaje por el composer. */
export async function enviar(page: Page, texto: string): Promise<void> {
  await composer(page).fill(texto);
  await page.getByRole("button", { name: "Enviar" }).click();
}

/** La barra o el carril de navegación (solo hay uno montado a la vez). */
export function navegacion(page: Page) {
  return page.getByRole("navigation", { name: "Navegación principal" });
}

/** El log de la conversación. */
export function conversacion(page: Page) {
  return page.getByRole("log", { name: "Conversación" });
}
