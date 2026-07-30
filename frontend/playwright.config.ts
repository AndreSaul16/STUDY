import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración de las pruebas E2E.
 *
 * Dos decisiones de fondo:
 *
 * 1. **`vite dev`, nunca `vite build`.** Las pruebas no son parte del ciclo de
 *    despliegue: `frontend/dist` se commitea y lo genera otro proceso.
 * 2. **El backend NO se arranca.** Todo `/api/**` se intercepta con
 *    `page.route`. Sin Python, sin red y sin API keys: las pruebas son
 *    deterministas y se pueden ejecutar en cualquier sitio.
 *
 * Los tres proyectos cubren los tres breakpoints reales de la app
 * (useMediaQuery.ts): móvil <768, tablet 768-1149 y escritorio ≥1150. El de
 * tablet existe porque esa franja —con `DesktopRail` y el `ModePicker` en
 * hoja— es donde más fácil se rompe el layout.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 30_000,
  // 7 s y no los 5 por defecto: sql.js carga un WASM antes del primer render.
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    // 127.0.0.1 y NO localhost, a propósito. En WSL2 (y en cualquier máquina
    // con doble pila) "localhost" resuelve a ::1 y a 127.0.0.1 a la vez, y con
    // el centenar de peticiones de módulo que hace `vite dev` alguna cae con
    // ERR_NETWORK_CHANGED. La app se queda a medio cargar y el test falla por
    // algo que no tiene nada que ver con el código. Medido: ~2 de cada 12
    // arranques con "localhost", 0 de 12 con la IP.
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    locale: "es-ES",
  },

  projects: [
    { name: "movil", use: { ...devices["Pixel 7"] } },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 834, height: 1194 },
      },
    },
    {
      name: "escritorio",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  // El servidor SSE de pruebas se arranca aquí, dentro del propio proceso, y
  // no como un `webServer` más: dos servidores en paralelo se atascaban en
  // máquinas lentas. Ver e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",

  webServer: {
    command: "pnpm dev --port 5173 --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // `server.open: true` en vite.config.ts lanzaría un navegador de verdad
    // en cada arranque. Sin escritorio, eso son errores en el log.
    env: { BROWSER: "none" },
  },
});
