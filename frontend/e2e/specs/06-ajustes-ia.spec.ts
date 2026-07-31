import { expect, test } from "@playwright/test";
import { abrirApp, enviar, navegacion } from "../fixtures/app";
import { MODELOS_GOOGLE } from "../fixtures/api";
import { RESPUESTA_SIMPLE, mockChatStream } from "../fixtures/sse";

const KEY_FALSA = "AIzaTESTTESTTESTTESTTESTTESTTEST";

/**
 * Ajustes de IA (BYOK).
 *
 * El test que no se puede tocar es el de la petición: la API key tiene que ir
 * en la cabecera `X-AI-Api-Key` y **no puede aparecer en la URL** ni en el
 * cuerpo. En la URL acabaría en los logs del proxy y en el historial del
 * navegador; una vez ahí, ya no hay forma de sacarla.
 */
test.describe("Ajustes de IA", () => {
  const irAAjustes = async (page: import("@playwright/test").Page) => {
    await navegacion(page).getByRole("button", { name: "Más" }).click();
    await expect(page.getByRole("heading", { name: "Inteligencia artificial" })).toBeVisible();
  };

  test("comprobar la key puebla el desplegable de modelos", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await page.getByRole("radio", { name: "Google Gemini" }).click();
    await page.getByLabel(/Tu API key/).fill(KEY_FALSA);
    await page.getByRole("button", { name: "Comprobar y cargar modelos" }).click();

    await expect(page.getByText(/Key válida · 2 modelos/)).toBeVisible();
    await expect(page.getByLabel("Modelo")).toContainText("Gemini 3.5 Flash");
  });

  test("la key elegida viaja en la cabecera y nunca en la URL", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await page.getByRole("radio", { name: "Google Gemini" }).click();
    await page.getByLabel(/Tu API key/).fill(KEY_FALSA);
    await page.getByRole("button", { name: "Comprobar y cargar modelos" }).click();
    await expect(page.getByText(/Key válida/)).toBeVisible();
    await page.getByLabel("Modelo").selectOption("gemini-3.5-flash");

    await mockChatStream(page, RESPUESTA_SIMPLE);
    const peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));

    await navegacion(page).getByRole("button", { name: "Chat" }).click();
    await enviar(page, "Una pregunta");

    const request = await peticion;
    expect(request.headers()["x-ai-api-key"]).toBe(KEY_FALSA);
    expect(request.url()).not.toContain(KEY_FALSA);

    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    expect(body.provider).toBe("google");
    expect(body.model).toBe("gemini-3.5-flash");
    // La key SOLO en la cabecera: en el cuerpo acabaría en cualquier registro.
    expect(JSON.stringify(body)).not.toContain(KEY_FALSA);
  });

  test("una key inválida se dice con todas las letras", async ({ page }) => {
    await abrirApp(page);
    await page.route("**/api/ai/models", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "La API key no es válida para OpenAI." }),
      }),
    );
    await irAAjustes(page);

    await page.getByLabel(/Tu API key/).fill("sk-noesunakeydeverdadnoesunakey");
    await page.getByRole("button", { name: "Comprobar y cargar modelos" }).click();

    await expect(page.getByText("La API key no es válida para OpenAI.")).toBeVisible();
  });

  test("cambiar de proveedor y volver conserva las dos keys", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await page.getByLabel(/Tu API key/).fill("sk-lakeydeopenaiquenosepierde");
    await page.getByRole("radio", { name: "Google Gemini" }).click();
    await page.getByLabel(/Tu API key/).fill(KEY_FALSA);

    await page.getByRole("radio", { name: "OpenAI" }).click();

    // Pegar una API key en un móvil es de las peores tareas que existen: no se
    // puede obligar a repetirla por cambiar de proveedor y volver.
    await expect(page.getByLabel(/Tu API key/)).toHaveValue("sk-lakeydeopenaiquenosepierde");
  });

  test("borrar la key devuelve al modo servidor", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await page.getByLabel(/Tu API key/).fill("sk-unakeycualquieraparaborrar");
    await page.getByRole("button", { name: "Borrar mi key" }).click();

    await expect(page.getByLabel(/Tu API key/)).toHaveValue("");

    await mockChatStream(page, RESPUESTA_SIMPLE);
    const peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await navegacion(page).getByRole("button", { name: "Chat" }).click();
    await enviar(page, "Otra pregunta");

    const request = await peticion;
    expect(request.headers()["x-ai-api-key"]).toBeUndefined();
  });

  test("sin key propia no viaja la cabecera, pero el esfuerzo sí", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    const peticion = page.waitForRequest((r) => r.url().includes("/api/chat/stream"));
    await enviar(page, "Sin configurar nada");

    const request = await peticion;
    expect(request.headers()["x-ai-api-key"]).toBeUndefined();

    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;

    // La key nunca sale del dispositivo y el proveedor lo decide el servidor.
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("apiKey");

    // Pero el esfuerzo SÍ viaja aunque se use la key del servidor. Antes se
    // retenía, y cambiarlo en la interfaz no producía ningún efecto: se
    // guardaba en el dispositivo y ahí moría.
    expect(body.effort).toBeTruthy();
  });

  test("el guardado de la key deja explícito dónde vive", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await expect(
      page.getByText(/Tu key se guarda solo en este dispositivo/),
    ).toBeVisible();
  });

  test("la key acaba en localStorage y en ningún otro sitio", async ({ page }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await page.getByLabel(/Tu API key/).fill(KEY_FALSA);

    const guardado = await page.evaluate(() =>
      localStorage.getItem("study-ai-settings"),
    );
    expect(guardado).toContain(KEY_FALSA);

    // Y NO en la base local, que se exporta y se comparte.
    const enLaBase = await page.evaluate(() => {
      const claves = Object.keys(localStorage);
      return claves.filter((k) => k !== "study-ai-settings");
    });
    for (const clave of enLaBase) {
      const valor = await page.evaluate((k) => localStorage.getItem(k), clave);
      expect(valor ?? "").not.toContain(KEY_FALSA);
    }
  });
});
