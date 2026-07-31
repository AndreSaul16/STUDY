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
/**
 * Dónde se lee el modo activo según el ancho.
 *
 * En escritorio holgado el `hint` del modo es el placeholder del campo. Fuera
 * de ahí NO: es una frase entera, no cabe en una línea, y el campo vacío mide
 * lo mínimo a propósito, así que la segunda línea se cortaba por abajo. Ahí el
 * modo se lee en el botón del ModePicker, que está justo encima del campo.
 */
async function esperarModoActivo(
  page: import("@playwright/test").Page,
  proyecto: string,
  etiqueta: string,
  hint: string,
) {
  if (proyecto === "escritorio") {
    await expect(composer(page)).toHaveAttribute("placeholder", hint);
    return;
  }
  await expect(page.getByRole("button", { name: `Modo de redacción: ${etiqueta}` })).toBeVisible();
  await expect(composer(page)).toHaveAttribute("placeholder", "Escribe tu pregunta…");
}

test.describe("Modos de redacción", () => {
  test("cambiar de modo se ve en el composer", async ({ page }, testInfo) => {
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

    await esperarModoActivo(
      page,
      testInfo.project.name,
      "Comentario de 30 s",
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

    await esperarModoActivo(
      page,
      testInfo.project.name,
      "Ilustración",
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
