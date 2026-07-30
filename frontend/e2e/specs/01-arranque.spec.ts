import { expect, test } from "@playwright/test";
import { abrirApp, composer, navegacion, seed } from "../fixtures/app";

/**
 * Arranque.
 *
 * La app abre en el CHAT, no en el lector: ese fue el cambio de fondo de la
 * iteración anterior y es lo primero que se rompería al tocar `uiStore`.
 */
test.describe("Arranque", () => {
  test("abre en el chat con el estado vacío del modo activo", async ({ page }) => {
    await abrirApp(page);

    await expect(page.getByRole("heading", { name: "¿Qué preparamos hoy?" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "¿Qué significa ser «reparadores de brechas»?" }),
    ).toBeVisible();
  });

  test("sql.js arranca y deja el composer utilizable", async ({ page }) => {
    await abrirApp(page);

    await composer(page).fill("hola");
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled();
  });

  test("pulsar un ejemplo lo lleva al composer sin enviarlo", async ({ page }) => {
    await abrirApp(page);

    await page.getByRole("button", { name: "¿Por qué Jeremías siguió predicando?" }).click();

    await expect(composer(page)).toHaveValue("¿Por qué Jeremías siguió predicando?");
    // Sin enviar: el usuario todavía puede editarlo.
    await expect(page.getByRole("heading", { name: "¿Qué preparamos hoy?" })).toBeVisible();
  });

  test("los ejemplos son los del modo guardado, no los del primero", async ({ page }) => {
    await seed(page, { mode: "comentario" });
    await abrirApp(page);

    await expect(page.getByRole("button", { name: "Comentario de Isaías 58:12" })).toBeVisible();
  });

  test("la navegación principal está montada", async ({ page }) => {
    await abrirApp(page);

    await expect(navegacion(page)).toBeVisible();
    await expect(navegacion(page).getByRole("button", { name: "Chat" })).toBeVisible();
  });
});
