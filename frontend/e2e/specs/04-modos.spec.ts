import { expect, test } from "@playwright/test";
import { abrirApp, composer } from "../fixtures/app";

/**
 * El selector de modo.
 *
 * Cambia de forma según el ancho, y ese corte está en 1150 y no en 768 por un
 * motivo concreto: en la franja de tablet la columna del chat mide ~420px y
 * los seis chips no caben. Estos tests fijan ese comportamiento en los tres
 * tamaños.
 */
test.describe("Modos de redacción", () => {
  test("cambiar de modo cambia el placeholder del composer", async ({ page }, testInfo) => {
    await abrirApp(page);

    if (testInfo.project.name === "escritorio") {
      await page.getByRole("radio", { name: /Comentario de 30 s/ }).click();
    } else {
      await page.getByRole("button", { name: /Modo de redacción/ }).click();
      await page
        .getByRole("dialog", { name: "Modo de redacción" })
        .getByRole("button", { name: /Comentario de 30 s/ })
        .click();
    }

    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "Pega el punto o el versículo y te lo redacto",
    );
  });

  test("el modo elegido sobrevive a una recarga", async ({ page }, testInfo) => {
    await abrirApp(page);

    if (testInfo.project.name === "escritorio") {
      await page.getByRole("radio", { name: /Ilustración/ }).click();
    } else {
      await page.getByRole("button", { name: /Modo de redacción/ }).click();
      await page
        .getByRole("dialog", { name: "Modo de redacción" })
        .getByRole("button", { name: /^Ilustración/ })
        .click();
    }

    await page.reload();
    await expect(composer(page)).toBeVisible();

    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "Dime el punto y te busco una ilustración real",
    );
  });

  test("escritorio ancho pinta chips; tablet y móvil, una hoja", async ({ page }, testInfo) => {
    await abrirApp(page);

    if (testInfo.project.name === "escritorio") {
      await expect(page.getByRole("radiogroup", { name: "Modo de redacción" })).toBeVisible();
      return;
    }

    // Debajo de 1150 los seis chips no caben: un botón que abre una hoja.
    await expect(page.getByRole("radiogroup", { name: "Modo de redacción" })).toHaveCount(0);
    await page.getByRole("button", { name: /Modo de redacción/ }).click();
    await expect(page.getByRole("dialog", { name: "Modo de redacción" })).toBeVisible();
  });

  test("la investigación profunda avisa de lo que cuesta", async ({ page }, testInfo) => {
    await abrirApp(page);

    if (testInfo.project.name !== "escritorio") {
      await page.getByRole("button", { name: /Modo de redacción/ }).click();
    }

    // Que tarda minutos hay que decirlo ANTES, no después de elegirlo.
    await expect(page.getByText(/≈4 min/).first()).toBeVisible();
  });
});
