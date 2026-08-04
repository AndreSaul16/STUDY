import { expect, test, type Page } from "@playwright/test";
import { abrirApp, conversacion, enviar, seed } from "../fixtures/app";
import { RESPUESTA_SIMPLE, fulfillSSE, mockChatStream } from "../fixtures/sse";

const KEY_OPENAI = "sk-TESTTESTTESTTESTTESTTESTTESTTEST";
const KEY_GOOGLE = "AIzaTESTTESTTESTTESTTESTTESTTEST";

/**
 * Varias conversaciones abiertas a la vez.
 *
 * Los dos primeros tests son los que de verdad hay que vigilar:
 *
 *  1. Cambiar de conversación NO puede cortar la respuesta que se está
 *     generando en la anterior. Antes sí lo hacía, porque el turno vivía en una
 *     única variable de módulo y el estado del chat era uno solo.
 *  2. Cada conversación manda su proveedor, su modelo y su esfuerzo, con la key
 *     del proveedor que le toca. Mandar la key de OpenAI con `provider: google`
 *     —porque el ajuste global iba por otro lado— es un 401 y una hora de
 *     buscar dónde está el fallo.
 */
test.describe("Varios chats a la vez", () => {
  const nuevaDesdeCabecera = (page: Page) =>
    page.getByRole("button", { name: "Nueva conversación" }).click();

  const abrirCajon = (page: Page) =>
    page.getByRole("button", { name: "Conversaciones" }).click();

  const cajon = (page: Page) => page.getByRole("dialog", { name: "Conversaciones" });

  /**
   * La tira de pestañas, acotada por su nombre.
   *
   * Fuera del móvil el panel de investigación monta su propio `tablist`
   * (Chat / Leer / Notas…), así que un `getByRole("tab")` suelto contaba once
   * pestañas donde había cinco.
   */
  const tira = (page: Page) =>
    page.getByRole("tablist", { name: "Conversaciones abiertas" });
  const pestanas = (page: Page) => tira(page).getByRole("tab");

  /**
   * Espera a que el turno se haya cerrado de verdad.
   *
   * El texto de la respuesta aparece con el primer token, ANTES del `done`, así
   * que esperar solo al texto abre la siguiente conversación con la anterior
   * todavía generando. Eso no rompe nada —una conversación que está trabajando
   * no se desaloja, y es a propósito— pero hace el test no determinista.
   */
  const turnoCerrado = (page: Page) =>
    expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();

  test("un turno en una conversación sigue vivo al abrir otra", async ({ page }) => {
    await abrirApp(page);

    // Un stream que se queda pendiente hasta que el test lo suelta: es la única
    // forma de tener una respuesta a medias mientras se navega a otra parte.
    let soltar: () => void = () => {};
    const enEspera = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    await page.route("**/api/chat/stream", async (route) => {
      await enEspera;
      await fulfillSSE(route, RESPUESTA_SIMPLE);
    });

    await enviar(page, "Pregunta de la primera");
    await expect(page.getByRole("button", { name: "Detener la respuesta" })).toBeVisible();

    // Segunda conversación. La primera se queda generando por detrás.
    await nuevaDesdeCabecera(page);

    // El indicador: la pestaña de la primera dice que está trabajando.
    await expect(pestanas(page).filter({ hasText: "Pregunta de la primera" })).toBeVisible();
    await expect(
      tira(page).getByRole("tab", { name: /Pregunta de la primera · generando/ }),
    ).toBeVisible();
    // Y aquí se puede escribir: el composer de la segunda no está bloqueado por
    // un turno que no es suyo.
    await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();

    soltar();

    // La respuesta llega a SU conversación aunque no esté a la vista.
    await expect(tira(page).getByRole("tab", { name: /generando/ })).toHaveCount(0);
    await expect(conversacion(page).getByText("Respuesta breve de prueba.")).toHaveCount(0);

    await tira(page).getByRole("tab", { name: /Pregunta de la primera/ }).click();
    await expect(conversacion(page).getByText("Respuesta breve de prueba.")).toBeVisible();
  });

  test("cada conversación manda su modelo y su key", async ({ page }) => {
    await seed(page, {
      ai: {
        provider: "openai",
        effort: "medio",
        byProvider: {
          openai: { apiKey: KEY_OPENAI, model: "" },
          google: { apiKey: KEY_GOOGLE, model: "" },
        },
      },
    });
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    const abrirSelector = () =>
      page.getByRole("button", { name: "Modelo y esfuerzo de esta conversación" }).click();
    const cerrarSelector = () =>
      page.getByRole("dialog", { name: "Modelo y esfuerzo" }).getByRole("button", { name: "Cerrar" }).click();

    // ── Primera: OpenAI, modelo por defecto, esfuerzo alto ──
    await abrirSelector();
    await page.getByRole("radio", { name: "OpenAI" }).click();
    await page.getByRole("radio", { name: "Alto", exact: true }).click();
    await cerrarSelector();

    let peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await enviar(page, "Pregunta con OpenAI");
    let body = JSON.parse((await peticion).postData() ?? "{}") as Record<string, unknown>;
    expect((await peticion).headers()["x-ai-api-key"]).toBe(KEY_OPENAI);
    expect(body.provider).toBe("openai");
    expect(body.effort).toBe("alto");
    // Sin modelo elegido no se manda ninguno: manda el del proveedor.
    expect(body.model).toBeUndefined();
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();
    await turnoCerrado(page);

    // ── Segunda: Google, un modelo concreto, esfuerzo bajo ──
    await nuevaDesdeCabecera(page);
    await abrirSelector();
    await page.getByRole("radio", { name: "Google Gemini" }).click();
    await page.getByRole("radio", { name: "gemini-2.5-pro" }).click();
    await page.getByRole("radio", { name: "Bajo", exact: true }).click();
    await cerrarSelector();

    peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await enviar(page, "Pregunta con Gemini");
    body = JSON.parse((await peticion).postData() ?? "{}") as Record<string, unknown>;
    expect((await peticion).headers()["x-ai-api-key"]).toBe(KEY_GOOGLE);
    expect(body.provider).toBe("google");
    expect(body.model).toBe("gemini-2.5-pro");
    expect(body.effort).toBe("bajo");

    // ── Y la primera sigue siendo suya ──
    // Este es el test de verdad: configurar la segunda movió el proveedor por
    // defecto a Google, y aun así la primera tiene que volver a salir con
    // OpenAI y su propia key.
    await tira(page).getByRole("tab", { name: /Pregunta con OpenAI/ }).click();
    peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await enviar(page, "Segunda pregunta de la primera");
    body = JSON.parse((await peticion).postData() ?? "{}") as Record<string, unknown>;
    expect((await peticion).headers()["x-ai-api-key"]).toBe(KEY_OPENAI);
    expect(body.provider).toBe("openai");
    expect(body.effort).toBe("alto");
  });

  test("el modelo de cada conversación sobrevive a una recarga", async ({ page }) => {
    await seed(page, {
      ai: {
        provider: "openai",
        effort: "medio",
        byProvider: {
          openai: { apiKey: KEY_OPENAI, model: "" },
          google: { apiKey: KEY_GOOGLE, model: "" },
        },
      },
    });
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Conversación de Gemini");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await page.getByRole("button", { name: "Modelo y esfuerzo de esta conversación" }).click();
    await page.getByRole("radio", { name: "Google Gemini" }).click();
    await page.getByRole("radio", { name: "gemini-2.5-pro" }).click();
    await page
      .getByRole("dialog", { name: "Modelo y esfuerzo" })
      .getByRole("button", { name: "Cerrar" })
      .click();

    // El volcado a IndexedDB va con 500 ms de rebote.
    await page.waitForTimeout(1_200);
    await page.reload();
    await expect(conversacion(page).getByText("Respuesta breve de prueba.")).toBeVisible();

    const peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await enviar(page, "Otra pregunta");
    const request = await peticion;
    expect(request.headers()["x-ai-api-key"]).toBe(KEY_GOOGLE);
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    expect(body.provider).toBe("google");
    expect(body.model).toBe("gemini-2.5-pro");
  });

  test("las pestañas abiertas sobreviven a una recarga", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "Primera conversación");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();
    await turnoCerrado(page);
    await nuevaDesdeCabecera(page);
    await enviar(page, "Segunda conversación");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await expect(pestanas(page)).toHaveCount(2);

    await page.waitForTimeout(1_200);
    await page.reload();

    await expect(pestanas(page)).toHaveCount(2);
    await expect(
      tira(page).getByRole("tab", { name: /Segunda conversación/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("cerrar una pestaña no borra la conversación", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    await enviar(page, "La que se queda");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();
    await turnoCerrado(page);
    await nuevaDesdeCabecera(page);
    await enviar(page, "La que se cierra");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    await page.getByRole("button", { name: "Cerrar La que se cierra" }).click();

    // Con una sola abierta la tira desaparece: el chat de siempre no paga
    // ningún píxel por una función que no está usando.
    await expect(tira(page)).toHaveCount(0);
    await expect(conversacion(page).getByText("La que se queda")).toBeVisible();

    // Pero sigue en el historial: cerrar no es borrar.
    await abrirCajon(page);
    await expect(cajon(page).getByText("La que se cierra")).toBeVisible();
  });

  test("no se pueden tener más de cinco abiertas a la vez", async ({ page }) => {
    // Los 30 s por defecto no le llegan: para llenar la tira hay que abrir SEIS
    // conversaciones, y cada una es un turno completo (enviar, esperar el
    // stream, esperar el cierre). En aislamiento cabe de sobra, pero la suite
    // corre los tres tamaños de pantalla a la vez y con la máquina cargada se
    // pasa. Falló una vez de siete ejecuciones, siempre bajo esa concurrencia.
    // Se le da margen en vez de recortar el escenario: el tope de cinco solo se
    // demuestra abriendo seis.
    test.setTimeout(90_000);

    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    // Con mensaje en cada una: una conversación en blanco se REUTILIZA en vez
    // de abrir otra pestaña, que es lo que evita llenar la tira de vacías.
    for (let i = 1; i <= 6; i += 1) {
      if (i > 1) await nuevaDesdeCabecera(page);
      await enviar(page, `Conversación número ${i}`);
      await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();
      await turnoCerrado(page);
    }

    await expect(pestanas(page)).toHaveCount(5);
    // La desalojada es la más antigua, y sigue en el historial.
    await expect(tira(page).getByRole("tab", { name: /Conversación número 1/ })).toHaveCount(0);
    await expect(tira(page).getByRole("tab", { name: /Conversación número 6/ })).toBeVisible();

    await abrirCajon(page);
    await expect(cajon(page).getByText("Conversación número 1")).toBeVisible();
  });
});
