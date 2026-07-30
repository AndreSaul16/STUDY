import { expect, test } from "@playwright/test";
import {
  abrirApp,
  composer,
  conversacion,
  enviar,
  mockChatStreamLento,
} from "../fixtures/app";
import { RESPUESTA_COMPLETA, mockChatStream } from "../fixtures/sse";

/**
 * El turno completo del chat.
 *
 * Es el flujo que justifica la app: preguntar, ver que la IA está consultando
 * fuentes de verdad, recibir la pieza redactada y poder seguir tirando del
 * hilo con las sugerencias.
 */
test.describe("Conversación", () => {
  test("un turno completo pinta el texto, la cita, las fuentes y las sugerencias", async ({
    page,
  }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");

    // El turno del usuario se persiste ANTES de abrir el stream.
    await expect(conversacion(page).getByText("Comentario de Isaías 58:12")).toBeVisible();

    // La pieza redactada va en su propia tarjeta, con su botón de copiar.
    await expect(page.getByText("Para leer en voz alta")).toBeVisible();
    await expect(page.getByText(/reparadores de brechas/)).toBeVisible();

    // Las fuentes van plegadas: una fila de chips siempre visible pesa mucho
    // en un móvil.
    await expect(page.getByRole("button", { name: /Fuentes \(2\)/ })).toBeVisible();
    await page.getByRole("button", { name: /Fuentes \(2\)/ }).click();
    await expect(page.getByText("La Atalaya, 15 de mayo de 2015")).toBeVisible();

    await expect(page.getByRole("button", { name: "¿Qué dice el contexto?" })).toBeVisible();
  });

  test("el rastro de herramientas cuenta qué está haciendo la IA", async ({ page }) => {
    await abrirApp(page);
    // Servidor SSE de verdad: el stream tiene que seguir ABIERTO para poder
    // ver el rastro. Con `route.fulfill` el turno se cierra al instante y el
    // rastro desaparece antes de que dé tiempo a mirarlo.
    await mockChatStreamLento(page, "herramientas");

    await enviar(page, "Háblame del aguante");

    // La consulta en curso, con su argumento: es lo que distingue "está
    // trabajando" de "se ha colgado".
    await expect(page.getByText("Buscando en la Biblioteca en Línea · aguante")).toBeVisible();

    // Y la ya resuelta baja a la lista con su resumen.
    await expect(page.getByText("Leyendo el artículo")).toBeVisible();
    await expect(page.getByText(/6 resultados/)).toBeVisible();
  });

  test("el metadata dice con qué modelo se respondió", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");

    // Releyendo una conversación de hace un mes hay que poder saber si la
    // escribió el modelo bueno o el barato.
    await expect(page.getByText(/5\.6-luna · esfuerzo alto/)).toBeVisible();
  });

  test("un error del servidor ofrece reintentar", async ({ page }) => {
    await abrirApp(page);
    await page.route("**/api/chat/stream", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await enviar(page, "Esto va a fallar");

    await expect(page.getByRole("button", { name: "Reintentar" }).first()).toBeVisible();
  });

  test("cancelar guarda el parcial marcado como cancelado", async ({ page }) => {
    await abrirApp(page);
    // El escenario "parcial" manda un token y deja el stream abierto: el
    // botón de detener sigue ahí y hay algo escrito que rescatar.
    await mockChatStreamLento(page, "parcial");

    await enviar(page, "Escribe algo largo");
    await expect(page.getByText("Empiezo a redactar y")).toBeVisible();

    await page.getByRole("button", { name: "Detener la respuesta" }).click();

    // El parcial es trabajo del usuario, no basura: se guarda marcado.
    await expect(page.getByText(/\[cancelado\]/)).toBeVisible();
    // Y el composer vuelve a estar disponible.
    await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
  });

  test("pulsar una sugerencia la deja en el composer", async ({ page }) => {
    await abrirApp(page);
    await mockChatStream(page, RESPUESTA_COMPLETA);

    await enviar(page, "Comentario de Isaías 58:12");
    await page.getByRole("button", { name: "¿Qué dice el contexto?" }).click();

    await expect(composer(page)).toHaveValue("¿Qué dice el contexto?");
  });
});
