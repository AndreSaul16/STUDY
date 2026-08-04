import { expect, test, type Page } from "@playwright/test";
import { abrirApp, composer, navegacion } from "../fixtures/app";
import { PROVEEDORES } from "../fixtures/api";

/**
 * Lo que todavía no se puede hacer, dicho a la cara.
 *
 * Al desplegar hay tres realidades y confundirlas es mentir:
 *
 *  1. **Próximamente**: lo vamos a hacer nosotros (cotejo de traducciones,
 *     .jwpub en la investigación profunda).
 *  2. **Lo activas tú**: funciona, pero falta una clave en el servidor
 *     (búsqueda web ampliada).
 *  3. **Sin soporte**: el proveedor no lo ofrece y no está en nuestra mano
 *     (voz en Google y MiniMax).
 *
 * Lo que estos tests vigilan de verdad no es que el texto exista, sino que **no
 * se mezclen los tonos**: que el aviso de la clave no prometa nada y que el del
 * 404 no diga «próximamente». Y que ninguno sea un callejón sin salida: los
 * tres tienen que decir qué SÍ funciona hoy.
 */

const irAAjustes = async (page: Page) => {
  await navegacion(page).getByRole("button", { name: "Más" }).click();
  await expect(
    page.getByRole("heading", { name: "Inteligencia artificial" }),
  ).toBeVisible();
};

/**
 * Los mismos proveedores, pero declarando capacidades de voz.
 *
 * El mock compartido no las trae, y sin ellas `voiceCapableProviders` devuelve
 * lista vacía y la sección de voz ni se pinta. Va sólo aquí y no en el fixture
 * común a propósito: montar el selector de voz añade un segundo radio «OpenAI»
 * y un segundo desplegable «Modelo…» a la pantalla de Ajustes, y eso rompería
 * los localizadores de las pruebas de BYOK, que no van de esto.
 */
const PROVEEDORES_CON_VOZ = {
  ...PROVEEDORES,
  providers: PROVEEDORES.providers.map((p) =>
    p.id === "openai"
      ? {
          ...p,
          supports_stt: true,
          supports_tts: true,
          stt_models: ["whisper-1", "gpt-4o-transcribe"],
          tts_models: ["gpt-4o-mini-tts"],
          tts_voices: ["alloy", "coral"],
        }
      : // Como en producción: su capa compatible responde 404 en /audio/*.
        {
          ...p,
          supports_stt: false,
          supports_tts: false,
          stt_models: [],
          tts_models: [],
          tts_voices: [],
        },
  ),
};

/**
 * Abre la app con un proveedor que sí transcribe y otro que no.
 *
 * Recarga después de instalar la ruta porque el catálogo se pide una sola vez,
 * al arrancar: registrarla más tarde llegaría con la petición ya hecha.
 */
const abrirConVoz = async (page: Page) => {
  await abrirApp(page);
  await page.route("**/api/ai/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PROVEEDORES_CON_VOZ),
    }),
  );
  await page.reload();
  await expect(composer(page)).toBeVisible();
};

const irACapitulos = async (page: Page) => {
  await navegacion(page).getByRole("button", { name: "Biblia" }).click();
  await page.getByRole("button", { name: /^Isaías/ }).click();
  await expect(page.getByText("66 capítulos")).toBeVisible();
};

/** La hoja de aviso abierta. Sólo puede haber una. */
const aviso = (page: Page) => page.getByRole("dialog");

// ─── 1. Cotejo de traducciones: promesa ──────────────────────────

test.describe("Comparar traducciones", () => {
  test("el punto de entrada está en el panel de la Biblia, marcado", async ({
    page,
  }) => {
    await abrirApp(page);
    await irACapitulos(page);

    const entrada = page.getByRole("button", { name: /Comparar traducciones/ });
    await expect(entrada).toBeVisible();
    await expect(entrada).toContainText("Próximamente");

    // Objetivo táctil: el resto de la app no baja de 44px y esto tampoco.
    const caja = await entrada.boundingBox();
    expect(caja!.height).toBeGreaterThanOrEqual(44);
  });

  test("dice qué se podrá hacer, con qué traducciones y qué ya funciona", async ({
    page,
  }) => {
    await abrirApp(page);
    await irACapitulos(page);
    await page.getByRole("button", { name: /Comparar traducciones/ }).click();

    const hoja = aviso(page);
    await expect(hoja).toBeVisible();
    await expect(hoja).toContainText("Próximamente");
    await expect(hoja).toContainText("Qué podrás hacer");

    // Las tres traducciones concretas, no un "varias versiones" vago.
    await expect(hoja).toContainText("Reina-Valera de 1909");
    await expect(hoja).toContainText("Sagradas Escrituras de 1569");
    await expect(hoja).toContainText("Reina-Valera de 1858");

    // Y por qué NO estarán las modernas: es la primera duda al leer "1909".
    await expect(hoja).toContainText(/Reina-Valera 1960/);

    // No es un callejón sin salida: dice qué hay hoy.
    await expect(hoja).toContainText("Lo que ya se puede hacer");
    await expect(hoja).toContainText("/api/references/compare");
  });

  test("se cierra con Escape y deja intacto lo que había debajo", async ({ page }) => {
    await abrirApp(page);
    await irACapitulos(page);
    await page.getByRole("button", { name: /Comparar traducciones/ }).click();
    await expect(aviso(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(aviso(page)).toBeHidden();
    // Cierra el aviso y sólo el aviso: seguimos en la rejilla de capítulos, no
    // de vuelta en la lista de libros.
    await expect(page.getByText("66 capítulos")).toBeVisible();
  });

  test("se cierra tocando fuera", async ({ page }) => {
    await abrirApp(page);
    await irACapitulos(page);
    await page.getByRole("button", { name: /Comparar traducciones/ }).click();
    await expect(aviso(page)).toBeVisible();

    // Arriba a la izquierda: el fondo, nunca la hoja, esté abajo (móvil) o
    // centrada (escritorio).
    await page
      .getByRole("button", { name: "Cerrar aviso" })
      .click({ position: { x: 10, y: 10 } });

    await expect(aviso(page)).toBeHidden();
  });

  test("el foco entra en la hoja, circula dentro y vuelve al botón", async ({
    page,
  }) => {
    await abrirApp(page);
    await irACapitulos(page);

    const entrada = page.getByRole("button", { name: /Comparar traducciones/ });
    await entrada.click();
    await expect(aviso(page)).toBeVisible();

    // El foco arranca en el diálogo: quien navega con teclado no tiene que
    // buscarlo.
    await expect(aviso(page)).toBeFocused();

    // Tab no puede escaparse a la pantalla de debajo. Con cinco tabulaciones y
    // dos elementos enfocables dentro, sigue dentro.
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("Tab");
    const dentro = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(dentro).toBe(true);

    await page.keyboard.press("Escape");
    await expect(aviso(page)).toBeHidden();
    // Y vuelve de donde salió, no al principio del documento.
    await expect(entrada).toBeFocused();
  });
});

// ─── 2. Publicaciones locales en investigación: promesa ──────────

test.describe("Tus .jwpub en la investigación profunda", () => {
  test("el ajuste dice que hoy solo aplica al chat", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    // En la propia frase, no sólo dentro del aviso: quien no lo pulse tiene que
    // enterarse igual.
    await expect(
      page.getByText(/Antes de cada respuesta del chat/),
    ).toBeVisible();

    const entrada = page.getByRole("button", {
      name: /En la investigación profunda todavía no/,
    });
    await expect(entrada).toContainText("Próximamente");
  });

  test("el aviso reconoce que hoy los ignora y ofrece lo que sí funciona", async ({
    page,
  }) => {
    await abrirApp(page);
    await irAAjustes(page);
    await page
      .getByRole("button", { name: /En la investigación profunda todavía no/ })
      .click();

    const hoja = aviso(page);
    await expect(hoja).toContainText("Próximamente");
    await expect(hoja).toContainText(/todavía no lee tus publicaciones/);
    await expect(hoja).toContainText("Lo que ya funciona");
    await expect(hoja).toContainText(/En el chat normal está hecho/);
  });

  test("el atajo del aviso lleva al chat, que es donde ya funciona", async ({
    page,
  }) => {
    await abrirApp(page);
    await irAAjustes(page);
    await page
      .getByRole("button", { name: /En la investigación profunda todavía no/ })
      .click();

    await aviso(page).getByRole("button", { name: "Ir al chat" }).click();

    await expect(aviso(page)).toBeHidden();
    await expect(
      navegacion(page).getByRole("button", { name: "Chat" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

// ─── 3. Búsqueda web ampliada: instrucción ───────────────────────

test.describe("Búsqueda web ampliada", () => {
  test("se presenta como un paso tuyo, no como una promesa nuestra", async ({
    page,
  }) => {
    await abrirApp(page);
    await irAAjustes(page);

    const entrada = page.getByRole("button", {
      name: /Añadir webs de referencia/,
    });
    await expect(entrada).toContainText("Lo activas tú");
    // Lo que NO puede decir: esto no lo vamos a hacer nosotros.
    await expect(entrada).not.toContainText(/Próximamente/i);
  });

  test("el aviso da las instrucciones exactas y no promete nada", async ({
    page,
  }) => {
    await abrirApp(page);
    await irAAjustes(page);
    await page.getByRole("button", { name: /Añadir webs de referencia/ }).click();

    const hoja = aviso(page);
    await expect(hoja).toContainText("Lo activas tú");
    await expect(hoja).toContainText("Cómo activarlo");
    await expect(hoja).toContainText("WEB_SEARCH_API_KEY");
    await expect(hoja).toContainText("WEB_SEARCH_PROVIDER=tavily");

    // Lo que ya funciona sin poner nada.
    await expect(hoja).toContainText("Lo que ya funciona sin clave");
    await expect(hoja).toContainText("OpenAlex");

    await expect(hoja).not.toContainText(/Próximamente/i);
  });
});

// ─── 4. Voz en Google y MiniMax: hecho del proveedor ─────────────

test.describe("Voz en los proveedores que no la ofrecen", () => {
  test("el ajuste lo dice con el 404 delante y sin prometer nada", async ({
    page,
  }) => {
    await abrirConVoz(page);
    await irAAjustes(page);

    await expect(
      page.getByText(/Google Gemini no aparece porque su API no tiene endpoint de audio/),
    ).toBeVisible();
    await expect(page.getByText(/se probó en vivo y responde 404/)).toBeVisible();

    const entrada = page.getByRole("button", {
      name: /Qué se comprobó y qué usar mientras/,
    });
    await expect(entrada).toContainText("Sin soporte");
    await expect(entrada).not.toContainText(/Próximamente/i);
  });

  test("el aviso es un hecho comprobado, no una promesa", async ({ page }) => {
    await abrirConVoz(page);
    await irAAjustes(page);
    await page
      .getByRole("button", { name: /Qué se comprobó y qué usar mientras/ })
      .click();

    const hoja = aviso(page);
    await expect(hoja).toContainText("Sin soporte");
    await expect(hoja).toContainText("Lo que se comprobó");
    await expect(hoja).toContainText("404");
    await expect(hoja).toContainText(/No depende de nosotros/);

    // Y qué usar mientras: OpenAI sí transcribe.
    await expect(hoja).toContainText("Lo que ya funciona");
    await expect(hoja).toContainText("OpenAI");

    // El tono prohibido aquí. Anunciarlo como inminente sería mentir: no
    // depende de nosotros y no sabemos si llegará.
    await expect(hoja).not.toContainText(/Próximamente/i);
  });
});

// ─── 5. Los tres tonos no se pisan ───────────────────────────────

test("cada aviso lleva una sola etiqueta y son distintas entre sí", async ({
  page,
}) => {
  await abrirConVoz(page);
  await irAAjustes(page);

  const etiquetaDe = async (nombre: RegExp) => {
    await page.getByRole("button", { name: nombre }).click();
    const hoja = aviso(page);
    await expect(hoja).toBeVisible();
    const etiquetas = ["Próximamente", "Lo activas tú", "Sin soporte"];
    const presentes: string[] = [];
    for (const etiqueta of etiquetas) {
      if (await hoja.getByText(etiqueta, { exact: true }).count()) {
        presentes.push(etiqueta);
      }
    }
    await page.keyboard.press("Escape");
    await expect(aviso(page)).toBeHidden();
    return presentes;
  };

  expect(await etiquetaDe(/En la investigación profunda todavía no/)).toEqual([
    "Próximamente",
  ]);
  expect(await etiquetaDe(/Añadir webs de referencia/)).toEqual(["Lo activas tú"]);
  expect(await etiquetaDe(/Qué se comprobó y qué usar mientras/)).toEqual([
    "Sin soporte",
  ]);
});
