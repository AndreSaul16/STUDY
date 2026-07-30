import { expect, test } from "@playwright/test";
import { abrirApp, enviar } from "../fixtures/app";
import { RESPUESTA_COMPLETA, mockChatStream } from "../fixtures/sse";

/**
 * Copiar la pieza redactada.
 *
 * Es el remate del caso de uso principal: el comentario se copia y se pega en
 * las notas de la reunión. Lo que se copia tiene que ir LIMPIO —sin el `>` de
 * la cita de bloque, sin los asteriscos de las negritas y sin las comillas
 * envolventes—, porque nadie va a editarlo a mano en un móvil.
 */
test.describe("Copiar", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    // Los permisos del portapapeles solo se conceden en Chromium.
    if (testInfo.project.name) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
  });

  test("la tarjeta copia el comentario sin marcas de Markdown", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");
    await expect(page.getByText("Para leer en voz alta")).toBeVisible();

    await page.getByRole("button", { name: "Copiar comentario" }).click();

    const copiado = await page.evaluate(() => navigator.clipboard.readText());

    expect(copiado).toContain("reparadores de brechas");
    expect(copiado).not.toContain(">");
    expect(copiado).not.toContain("**");
    expect(copiado.trim().startsWith('"')).toBe(false);
  });

  test("el botón anuncia que se copió", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");
    await page.getByRole("button", { name: "Copiar comentario" }).click();

    // Sin confirmación, el usuario pulsa dos y tres veces sin saber si funcionó.
    await expect(page.getByRole("button", { name: "Copiado" }).first()).toBeVisible();
  });

  test("las referencias se copian aparte", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");
    await page.getByRole("button", { name: /Fuentes \(2\)/ }).click();
    await page.getByRole("button", { name: "Copiar referencias" }).click();

    const copiado = await page.evaluate(() => navigator.clipboard.readText());

    expect(copiado).toContain("La Atalaya, 15 de mayo de 2015");
    expect(copiado).toContain("Isaías 58:12");
  });
});
