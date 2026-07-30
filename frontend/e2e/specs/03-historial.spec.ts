import { expect, test } from "@playwright/test";
import { abrirApp, composer, conversacion, enviar } from "../fixtures/app";
import { RESPUESTA_SIMPLE, mockChatStream } from "../fixtures/sse";

/**
 * El historial de conversaciones.
 *
 * Vive en el SQLite del navegador (IndexedDB), no en el backend: la app no
 * tiene autenticación y el contenedor tiene filesystem efímero. Por eso el
 * test de recarga es el importante: si la persistencia se rompe, el usuario
 * pierde todo su trabajo y nadie se entera hasta que se queja.
 */
test.describe("Historial", () => {
  const abrirCajon = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Conversaciones" }).click();

  const cajon = (page: import("@playwright/test").Page) =>
    page.getByRole("dialog", { name: "Conversaciones" });

  test("el primer mensaje pone título automático a la conversación", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Qué significa reparadores de brechas");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await abrirCajon(page);
    await expect(cajon(page).getByText("Qué significa reparadores de brechas")).toBeVisible();
  });

  test("renombrar una conversación", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Una pregunta cualquiera");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await abrirCajon(page);
    await cajon(page).getByRole("button", { name: "Renombrar" }).first().click();

    const campo = cajon(page).getByRole("textbox", {
      name: "Nuevo título de la conversación",
    });
    await campo.fill("Estudio de Isaías");
    await campo.press("Enter");

    await expect(cajon(page).getByText("Estudio de Isaías")).toBeVisible();
  });

  test("fijar una conversación la marca", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Otra pregunta");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await abrirCajon(page);
    await cajon(page).getByRole("button", { name: "Fijar" }).first().click();

    await expect(cajon(page).getByRole("button", { name: "Dejar de fijar" })).toBeVisible();
  });

  test("borrar pide confirmación antes de hacerlo", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Conversación que se borrará");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await abrirCajon(page);
    // Primer clic: solo arma la confirmación. Borrar sin preguntar fue
    // exactamente el problema del antiguo botón "Limpiar".
    await cajon(page).getByRole("button", { name: "Eliminar" }).first().click();
    await expect(cajon(page).getByRole("button", { name: "Confirmar borrado" })).toBeVisible();

    await cajon(page).getByRole("button", { name: "Confirmar borrado" }).click();
    await expect(cajon(page).getByText("Todavía no hay conversaciones.")).toBeVisible();
  });

  test("la conversación sobrevive a una recarga", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Esto tiene que persistir");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    // El volcado a IndexedDB va con 500 ms de rebote (sql.js serializa la base
    // entera, así que escribir en cada mensaje sería un parón visible). Se le
    // da margen: recargar antes de eso mediría el rebote, no la persistencia.
    await page.waitForTimeout(1_200);
    await page.reload();
    await expect(composer(page)).toBeVisible();

    // Acotado al log: el título de la conversación también contiene ese texto
    // (el auto-título son las primeras palabras del primer mensaje).
    await expect(conversacion(page).getByText("Esto tiene que persistir")).toBeVisible();
    await expect(conversacion(page).getByText("Respuesta breve de prueba.")).toBeVisible();
  });
});
