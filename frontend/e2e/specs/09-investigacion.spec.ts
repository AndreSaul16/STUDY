import { expect, test, type Page } from "@playwright/test";
import {
  abrirApp,
  composer,
  enviar,
  mockResearchStreamLento,
} from "../fixtures/app";
import { fulfillSSE, sse } from "../fixtures/sse";

/**
 * La investigación profunda: el único modo donde el turno de chat se cierra y
 * el trabajo sigue vivo en el servidor durante minutos.
 *
 * Los dos tests de aquí cubren las dos formas que tenía de dejar la app
 * inservible: que el seguimiento fallara y nadie cerrara el turno (el composer
 * se quedaba bloqueado PARA SIEMPRE), y que "Detener" no parara nada mientras
 * el backend seguía quemando llamadas al modelo.
 */

const JOB_ID = "job-de-prueba";

/** El turno de chat en modo profundo: un `job` y a colgar. */
async function mockTurnoProfundo(page: Page): Promise<void> {
  await page.route("**/api/chat/stream", (route) =>
    fulfillSSE(
      route,
      sse([
        ["job", { job_id: JOB_ID, estimated_seconds: 240 }],
        ["done", { total_tokens: 0, elapsed_ms: 0 }],
      ]),
    ),
  );
}

test.describe("Investigación profunda", () => {
  test("si el seguimiento se cae del todo, el composer vuelve", async ({ page }) => {
    await abrirApp(page);
    await mockTurnoProfundo(page);

    // El stream del trabajo falla siempre: tras agotar los reintentos, el
    // cliente tiene que rendirse Y cerrar el turno. Antes solo escribía el
    // error en el store de la investigación, `isStreaming` se quedaba en true
    // y no se podía volver a escribir sin recargar la página.
    await page.route("**/api/research/stream/*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await enviar(page, "Investiga a fondo el aguante");

    // 3 reintentos con 2 s de espera entre ellos: se le da margen de sobra.
    await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("button", { name: "Detener la respuesta" }),
    ).toHaveCount(0);

    // Y el motivo se ve: antes el error se escribía donde nadie lo leía.
    await expect(page.getByText(/investigación/i).first()).toBeVisible();

    // El composer acepta texto otra vez: eso es lo que estaba roto.
    await composer(page).fill("Otra pregunta");
    await expect(composer(page)).toHaveValue("Otra pregunta");
  });

  test("«Detener» cancela el trabajo en el servidor", async ({ page }) => {
    await abrirApp(page);
    await mockTurnoProfundo(page);
    await mockResearchStreamLento(page);

    const cancelaciones: string[] = [];
    await page.route("**/api/research/*/cancel", (route) => {
      cancelaciones.push(route.request().url());
      return route.fulfill({ status: 204, body: "" });
    });

    await enviar(page, "Investiga a fondo el aguante");

    // El plan se pinta: la barra de progreso está viva porque `start()` se
    // llama siempre, también al reanudar.
    await expect(
      page.getByRole("progressbar", { name: "Progreso de la investigación" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list").getByText("Qué dicen las publicaciones"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Detener la respuesta" })).toBeVisible();

    await page.getByRole("button", { name: "Detener la respuesta" }).click();

    // Lo que de verdad importa: el backend se entera. Sin esto seguía
    // investigando hasta cinco minutos por una respuesta que nadie iba a leer.
    await expect.poll(() => cancelaciones.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(cancelaciones[0]).toContain(JOB_ID);

    // Y el composer vuelve en el acto.
    await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
  });
});
