import { expect, test } from "@playwright/test";
import { abrirApp, composer, navegacion } from "../fixtures/app";

/**
 * Los cuatro destinos.
 *
 * En móvil los sirve `BottomNav` y en tablet/escritorio `DesktopRail`, pero el
 * contrato es el mismo: las cuatro vistas montan y la elegida sobrevive a una
 * recarga (en un móvil, esa es la diferencia entre retomar y volver a empezar).
 */
test.describe("Navegación", () => {
  test("las cuatro vistas montan sin que la app se rompa", async ({ page }) => {
    // Se vigilan los errores de render: una vista que revienta deja la
    // pantalla en blanco, y sin esto el test pasaría igual porque la barra de
    // navegación sigue ahí.
    const errores: string[] = [];
    page.on("pageerror", (e) => errores.push(e.message));

    await abrirApp(page);

    for (const destino of ["Biblia", "Leer", "Más", "Chat"]) {
      await navegacion(page).getByRole("button", { name: destino }).click();
      await expect(
        navegacion(page).getByRole("button", { name: destino }),
      ).toHaveAttribute("aria-current", "page");
    }

    await expect(composer(page)).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("la pantalla Más llega a los ajustes", async ({ page }) => {
    await abrirApp(page);

    await navegacion(page).getByRole("button", { name: "Más" }).click();

    await expect(page.getByRole("heading", { name: "Más" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Inteligencia artificial" }),
    ).toBeVisible();
  });

  test("la vista elegida sobrevive a una recarga", async ({ page }) => {
    await abrirApp(page);

    await navegacion(page).getByRole("button", { name: "Más" }).click();
    await expect(page.getByRole("heading", { name: "Más" })).toBeVisible();

    await page.reload();

    await expect(page.getByRole("heading", { name: "Más" })).toBeVisible();
  });

  test("el destino activo se marca para lectores de pantalla", async ({ page }) => {
    await abrirApp(page);

    await expect(navegacion(page).getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await navegacion(page).getByRole("button", { name: "Más" }).click();
    await expect(navegacion(page).getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(navegacion(page).getByRole("button", { name: "Chat" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("hay una sola barra de navegación montada", async ({ page }) => {
    await abrirApp(page);

    // Si algún día se montaran las dos a la vez, en tablet aparecerían el
    // carril y la barra inferior, y el chat perdería 56px por abajo.
    await expect(navegacion(page)).toHaveCount(1);
  });
});
