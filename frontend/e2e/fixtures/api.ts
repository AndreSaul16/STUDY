import type { Page, Request } from "@playwright/test";

/**
 * Mocks de la API.
 *
 * El backend NO se arranca en las pruebas: se intercepta `/api/**` entero. Eso
 * las hace deterministas (sin scraping de wol.jw.org, que tarda 20 s por
 * documento) y ejecutables sin Python ni API keys.
 *
 * `mockApi` se instala con una ruta comodín al final, para que cualquier
 * llamada que se nos haya olvidado devuelva un 200 vacío en vez de un error de
 * red que ensucie el test con un fallo que no es el que se está probando.
 */

export const MODOS = {
  default: "analisis",
  modes: [
    {
      id: "analisis",
      label: "Análisis con referencias",
      hint: "Pregunta lo que quieras y busco en las publicaciones",
      examples: [
        "¿Qué significa ser «reparadores de brechas»?",
        "¿Por qué Jeremías siguió predicando?",
        "Explícame el contexto de Filipenses 2",
      ],
      deep: false,
    },
    {
      id: "comentario",
      label: "Comentario de 30 s",
      hint: "Pega el punto o el versículo y te lo redacto",
      examples: ["Comentario de Isaías 58:12", "Comentario sobre la paciencia", "Comentario del párrafo 8"],
      deep: false,
    },
    {
      id: "ilustracion",
      label: "Ilustración",
      hint: "Dime el punto y te busco una ilustración real",
      examples: ["Ilustración sobre la constancia", "Ilustración sobre el aguante", "Ilustración para Juan 13:34"],
      deep: false,
    },
    {
      id: "discurso",
      label: "Discurso o parte",
      hint: "Dime el tema y la duración y te monto el guion",
      examples: ["Discurso de 5 minutos", "Parte de 10 minutos", "Guion para la lectura"],
      deep: false,
    },
    {
      id: "presentacion",
      label: "Presentación y oración",
      hint: "Dime el acto y te escribo el guion completo",
      examples: ["Programa para una boda", "Presentación de un discursante", "Oración inicial"],
      deep: false,
    },
    {
      id: "investigacion",
      label: "Investigación profunda",
      hint: "Dime el tema y lo investigo a fondo (varios minutos)",
      examples: ["Todo sobre el aguante", "Estudio completo de Isaías 58", "Trasfondo histórico de Ester"],
      deep: true,
    },
  ],
};

export const PROVEEDORES = {
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      key_hint: "sk-…",
      key_url: "https://platform.openai.com/api-keys",
      default_model: "gpt-5.6-luna",
      efforts: [
        { id: "ninguno", label: "Sin razonar (rápido)" },
        { id: "bajo", label: "Bajo" },
        { id: "medio", label: "Medio" },
        { id: "alto", label: "Alto" },
        { id: "maximo", label: "Máximo" },
      ],
      supports_images: true,
      supports_deep_research: true,
      image_models: ["gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2"],
    },
    {
      id: "google",
      label: "Google Gemini",
      key_hint: "AIza…",
      key_url: "https://aistudio.google.com/apikey",
      default_model: "gemini-3.5-flash",
      efforts: [
        { id: "ninguno", label: "Sin razonar (rápido)" },
        { id: "bajo", label: "Bajo" },
        { id: "medio", label: "Medio" },
        { id: "alto", label: "Alto" },
        { id: "maximo", label: "Máximo" },
      ],
      supports_images: true,
      supports_deep_research: false,
      image_models: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
    },
  ],
  server: {
    provider: "openai",
    model: "gpt-4o-mini",
    effort: "ninguno",
    has_server_key: true,
  },
};

export const MODELOS_GOOGLE = {
  provider: "google",
  purpose: "chat",
  source: "api",
  notice: null,
  models: [
    {
      id: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      description: "Equilibrio entre velocidad y calidad.",
      family: "gemini-3.5",
      reasoning: true,
      context: 1048576,
      recommended: true,
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      description: "Generación anterior.",
      family: "gemini-2.5",
      reasoning: true,
      context: 2097152,
      recommended: false,
    },
  ],
};

/**
 * Todas las llamadas al backend que la app hace al arrancar.
 *
 * **El orden importa y es al revés de lo que parece**: Playwright evalúa las
 * rutas de la última registrada a la primera, así que el comodín va PRIMERO y
 * las específicas después. Registrado al final, el comodín se comía
 * `/api/ai/models` y el desplegable llegaba vacío sin que nada lo explicara.
 */
export async function mockApi(page: Page): Promise<void> {
  // Red de seguridad: cualquier /api/** no cubierto abajo devuelve algo
  // inocuo. Un error de red aquí ensuciaría el test con un fallo ajeno.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );

  await page.route("**/api/chat/modes", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MODOS) }),
  );

  await page.route("**/api/ai/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PROVEEDORES),
    }),
  );

  await page.route("**/api/ai/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MODELOS_GOOGLE),
    }),
  );

  // El índice bíblico tiene que venir CON forma. `fetchBooks` hace
  // `data.books` sin comprobar, así que un `{}` deja `books` en undefined y el
  // `filter` del panel revienta el render entero: pantalla en blanco y ni
  // barra de navegación. Con el comodín devolviendo `{}` el fallo parecía de
  // la navegación y era del mock.
  await page.route("**/api/jw/bible/books", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ books: LIBROS }),
    }),
  );
}

/** Unos cuantos libros con la forma real de `BibleBook`. */
export const LIBROS = [
  { number: 1, name: "Génesis", chapters: 50 },
  { number: 19, name: "Salmos", chapters: 150 },
  { number: 23, name: "Isaías", chapters: 66 },
  { number: 43, name: "Juan", chapters: 21 },
  { number: 50, name: "Filipenses", chapters: 4 },
];

/** Registra las peticiones al stream del chat para poder inspeccionarlas. */
export function captureChatRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chat/stream")) requests.push(request);
  });
  return requests;
}
