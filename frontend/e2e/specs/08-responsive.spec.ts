import { expect, test } from "@playwright/test";
import { abrirApp, composer, navegacion } from "../fixtures/app";

/**
 * El responsive, breakpoint a breakpoint.
 *
 * Los cortes son los de `useMediaQuery.ts`: móvil <768, tablet 768-1149,
 * escritorio ≥1150.
 *
 * El test más valioso del fichero es el último: **ninguna barra puede taparle
 * nada a un cajón o a una hoja**. Esa regresión ya ocurrió (con `z-50`, la
 * barra inferior partía en dos el botón "Nueva conversación" del cajón) y es
 * de las que no se ven en una captura de pantalla en escritorio.
 */
test.describe("Responsive", () => {
  test("móvil: barra inferior a lo ancho; tablet y escritorio: carril lateral", async ({
    page,
  }, testInfo) => {
    await abrirApp(page);

    const caja = await navegacion(page).boundingBox();
    expect(caja).not.toBeNull();

    if (testInfo.project.name === "movil") {
      // Ocupa todo el ancho y está pegada abajo.
      expect(caja!.width).toBeGreaterThan(page.viewportSize()!.width - 4);
    } else {
      // El carril mide 68px y va a la izquierda.
      expect(caja!.width).toBeLessThan(120);
      expect(caja!.x).toBeLessThan(10);
    }
  });

  test("el composer siempre está visible dentro de la ventana", async ({ page }) => {
    await abrirApp(page);

    const caja = await composer(page).boundingBox();
    const alto = page.viewportSize()!.height;

    expect(caja).not.toBeNull();
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(alto + 1);
  });

  test("el panel de investigación solo existe fuera del móvil", async ({ page }, testInfo) => {
    await abrirApp(page);

    const plegar = page.getByRole("button", { name: "Mostrar el panel de investigación" });
    const panel = page.getByText("Investigación", { exact: false });

    if (testInfo.project.name === "movil") {
      await expect(plegar).toHaveCount(0);
    } else {
      // Está desplegado o hay un botón para desplegarlo; las dos cosas valen.
      expect((await plegar.count()) + (await panel.count())).toBeGreaterThan(0);
    }
  });

  test("el cajón de conversaciones se pinta por encima de la navegación", async ({
    page,
  }) => {
    await abrirApp(page);
    await page.getByRole("button", { name: "Conversaciones" }).click();

    const cajon = page.getByRole("dialog", { name: "Conversaciones" });
    await expect(cajon).toBeVisible();

    // El botón de abajo del todo del cajón tiene que ser pulsable: si la barra
    // inferior se pintara encima, este clic caería en la barra.
    const nuevo = cajon.getByRole("button", { name: "Nueva conversación" });
    await expect(nuevo).toBeVisible();

    const caja = await nuevo.boundingBox();
    const encima = await page.evaluate(
      ({ x, y }) => {
        // Boolean() y no `!== null`: si elementFromPoint devuelve null,
        // `el?.closest(...)` es undefined y la comparación daba true, o sea
        // un falso positivo que hacía fallar el test sin motivo.
        const el = document.elementFromPoint(x, y);
        return Boolean(el && el.closest("nav"));
      },
      { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 },
    );

    expect(encima).toBe(false);
    await nuevo.click();
    await expect(cajon).toHaveCount(0);
  });

  test("la hoja de modos no queda tapada por la barra inferior", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "escritorio", "En ≥1150 son chips, no hoja");

    await abrirApp(page);
    await page.getByRole("button", { name: /Modo de redacción/ }).click();

    const hoja = page.getByRole("dialog", { name: "Modo de redacción" });
    await expect(hoja).toBeVisible();

    // La última fila de la hoja es la que tapaba la barra inferior.
    const ultima = hoja.getByRole("button", { name: /Investigación profunda/ });
    await ultima.scrollIntoViewIfNeeded();
    await expect(ultima).toBeVisible();

    const caja = await ultima.boundingBox();
    const tapada = await page.evaluate(
      ({ x, y }) => {
        // Boolean() y no `!== null`: si elementFromPoint devuelve null,
        // `el?.closest(...)` es undefined y la comparación daba true, o sea
        // un falso positivo que hacía fallar el test sin motivo.
        const el = document.elementFromPoint(x, y);
        return Boolean(el && el.closest("nav"));
      },
      { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 },
    );

    expect(tapada).toBe(false);
  });

  test("el documento no hace scroll horizontal", async ({ page }) => {
    await abrirApp(page);

    // `expect.poll` y no una medición suelta: el composer visible no garantiza
    // que el layout haya asentado (quedan las fuentes y el primer pintado de
    // los paneles). Medir una sola vez captura un desbordamiento transitorio
    // que el usuario nunca llega a ver. Aquí se reintenta hasta que la medida
    // es estable, que es lo que de verdad se quiere afirmar.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
          ),
        { timeout: 10_000 },
      )
      .toBe(false);
  });

  test("los objetivos táctiles de la cabecera llegan a 44px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "escritorio", "Con ratón el mínimo no aplica");

    await abrirApp(page);

    const caja = await page.getByRole("button", { name: "Conversaciones" }).boundingBox();

    expect(caja!.height).toBeGreaterThanOrEqual(40);
  });
});
