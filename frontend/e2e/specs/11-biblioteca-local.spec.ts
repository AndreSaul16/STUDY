import { expect, test, type Page } from "@playwright/test";
import { abrirApp, enviar, navegacion } from "../fixtures/app";
import { captureChatRequests } from "../fixtures/api";
import { RESPUESTA_SIMPLE, mockChatStream } from "../fixtures/sse";

/**
 * Responder con las publicaciones .jwpub del usuario.
 *
 * Los .jwpub viven en IndexedDB del navegador y el agente corre en el servidor,
 * así que la búsqueda se hace aquí y solo viajan los fragmentos. Estos tests
 * cubren las dos mitades de esa decisión:
 *
 *  1. **El buscador**, ejecutando el módulo REAL dentro del navegador (`import`
 *     dinámico contra el dev server de Vite). No es un doble ni una copia del
 *     algoritmo: es el mismo fichero que se despliega.
 *  2. **El cableado**: que marcar un libro en Ajustes acabe metiendo esos
 *     fragmentos en el cuerpo de `POST /api/chat/stream`, y que no marcarlo no
 *     mande absolutamente nada.
 */

interface Fragmento {
  symbol: string;
  publication: string;
  documentId: number;
  documentTitle: string;
  text: string;
}

/** Una publicación con la forma exacta de `StoredPublication`. */
function publicacion(
  symbol: string,
  title: string,
  documentos: Array<[number, string, string]>,
) {
  return {
    symbol,
    publication: {
      symbol,
      title,
      year: 2020,
      language: 3,
      issueTagNumber: 0,
      publicationType: "Book",
      categories: [],
    },
    documents: documentos.map(([DocumentId, Title, Content]) => ({
      DocumentId,
      Title,
      Content,
      ContentLength: Content.length,
    })),
    toc: [],
    savedAt: Date.now(),
  };
}

/** Ejecuta el buscador de verdad dentro de la página. */
async function buscar(
  page: Page,
  consulta: string,
  publicaciones: unknown[],
): Promise<Fragmento[]> {
  return page.evaluate(
    async ({ consulta, publicaciones }) => {
      const mod = await import("/src/services/localLibrarySearch.ts");
      return mod.searchPublications(consulta, publicaciones);
    },
    { consulta, publicaciones },
  );
}

/** Igual, pero pasando por IndexedDB como en la app real. */
async function buscarEnBiblioteca(
  page: Page,
  consulta: string,
  simbolos: string[],
): Promise<Fragmento[]> {
  return page.evaluate(
    async ({ consulta, simbolos }) => {
      const mod = await import("/src/services/localLibrarySearch.ts");
      return mod.searchLocalLibrary(consulta, simbolos);
    },
    { consulta, simbolos },
  );
}

async function sembrarBiblioteca(page: Page, publicaciones: unknown[]) {
  await page.evaluate(async (pubs) => {
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open("study-library", 1);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        if (!db.objectStoreNames.contains("publications")) {
          db.createObjectStore("publications", { keyPath: "symbol" });
        }
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction("publications", "readwrite");
        for (const pub of pubs) tx.objectStore("publications").put(pub);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });
  }, publicaciones);
}

const RELLENO =
  "<p>Texto de relleno que no tiene nada que ver con la pregunta. </p>".repeat(60);

const LIBRO_AGUANTE = publicacion("bt", "Damos testimonio del Reino de Dios", [
  [
    10,
    "Capítulo 1: El principio",
    "<p class='p'>Este capítulo habla de los <b>comienzos</b> de la congregación.</p>",
  ],
  [
    20,
    "Capítulo 2: Seguir adelante",
    `${RELLENO}<p class='p'>El <b>aguante</b> produce una obra completa en quien lo cultiva.</p>${RELLENO}`,
  ],
  [
    30,
    "Capítulo 3: La constancia",
    "<p>Hablar de constancia es hablar de aguante en el ministerio diario.</p>",
  ],
]);

const LIBRO_ORACION = publicacion("cl", "Acerquémonos a Jehová", [
  [40, "El poder de la oración", "<p>La oración sincera fortalece el aguante.</p>"],
]);

// ─── El buscador ─────────────────────────────────────────────────

test.describe("Búsqueda en la biblioteca local", () => {
  test("encuentra el término y descarta lo que no viene a cuento", async ({ page }) => {
    await abrirApp(page);

    const fragmentos = await buscar(page, "¿Qué dice sobre el aguante?", [
      LIBRO_AGUANTE,
    ]);

    // El capítulo 1 no menciona el aguante: no puede colarse.
    expect(fragmentos.map((f) => f.documentId).sort()).toEqual([20, 30]);
    expect(fragmentos[0]!.symbol).toBe("bt");
    expect(fragmentos[0]!.publication).toBe("Damos testimonio del Reino de Dios");
  });

  test("el extracto sale centrado en la coincidencia, no al principio", async ({
    page,
  }) => {
    await abrirApp(page);

    const fragmentos = await buscar(page, "aguante produce obra completa", [
      LIBRO_AGUANTE,
    ]);
    const capitulo2 = fragmentos.find((f) => f.documentId === 20)!;

    // La frase está enterrada tras miles de caracteres de relleno. Si el
    // extracto se cortara desde el principio, no aparecería.
    expect(capitulo2.text).toContain("El aguante produce una obra completa");
    expect(capitulo2.text.startsWith("…")).toBe(true);
    expect(capitulo2.text.endsWith("…")).toBe(true);
  });

  test("el HTML no llega al extracto", async ({ page }) => {
    await abrirApp(page);

    const fragmentos = await buscar(page, "aguante", [LIBRO_AGUANTE]);

    for (const fragmento of fragmentos) {
      expect(fragmento.text).not.toContain("<");
      expect(fragmento.text).not.toContain("class=");
    }
  });

  test("respeta los topes de número, de tamaño y de volumen total", async ({
    page,
  }) => {
    await abrirApp(page);

    // 30 documentos largos que casan TODOS: sin topes esto serían 100 KB
    // viajando al proveedor de IA en cada pregunta.
    const enorme = publicacion(
      "gr",
      "Libro grande",
      Array.from({ length: 30 }, (_, i) => {
        const doc: [number, string, string] = [
          i + 1,
          `Capítulo ${i + 1}`,
          `${RELLENO}<p>Todo sobre el aguante y la constancia del cristiano.</p>${RELLENO}`,
        ];
        return doc;
      }),
    );

    const fragmentos = await buscar(page, "aguante constancia cristiano", [enorme]);
    const total = fragmentos.reduce((suma, f) => suma + f.text.length, 0);

    expect(fragmentos.length).toBeLessThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(3500);
    for (const fragmento of fragmentos) {
      // +2 por los "…" de los bordes.
      expect(fragmento.text.length).toBeLessThanOrEqual(702);
    }
  });

  test("un libro largo no se lleva todos los huecos", async ({ page }) => {
    await abrirApp(page);

    const largo = publicacion(
      "gr",
      "Libro grande",
      Array.from({ length: 20 }, (_, i) => {
        const doc: [number, string, string] = [
          i + 1,
          `Capítulo ${i + 1}`,
          "<p>Todo sobre el aguante del cristiano.</p>",
        ];
        return doc;
      }),
    );

    const fragmentos = await buscar(page, "aguante cristiano", [largo, LIBRO_ORACION]);

    expect(fragmentos.filter((f) => f.symbol === "gr").length).toBeLessThanOrEqual(3);
    expect(fragmentos.some((f) => f.symbol === "cl")).toBe(true);
  });

  test("ignora los acentos en los dos sentidos", async ({ page }) => {
    await abrirApp(page);

    const acentuado = publicacion("ac", "Con acentos", [
      [1, "Reparación", "<p>La reparación de las brechas es una obra de fe.</p>"],
    ]);

    expect(await buscar(page, "reparacion brechas", [acentuado])).toHaveLength(1);
    expect(await buscar(page, "reparación brechas", [acentuado])).toHaveLength(1);
  });

  test("no casa un término dentro de otra palabra", async ({ page }) => {
    await abrirApp(page);

    const trampa = publicacion("tr", "Trampa", [
      [1, "Sin coincidencia", "<p>Este es un buen estudio de la congregación.</p>"],
    ]);

    // "udio" está dentro de "estudio" pero no es una palabra: un `includes()`
    // lo daría por bueno.
    expect(await buscar(page, "udio", [trampa])).toEqual([]);
    expect(await buscar(page, "estudio", [trampa])).toHaveLength(1);
  });

  test("una pregunta de solo palabras vacías no devuelve nada", async ({ page }) => {
    await abrirApp(page);

    // Sin filtro de vacías esto devolvería el documento entero como "relevante".
    expect(await buscar(page, "¿que es esto?", [LIBRO_AGUANTE])).toEqual([]);
  });

  test("con la biblioteca vacía no revienta", async ({ page }) => {
    await abrirApp(page);

    expect(await buscar(page, "aguante", [])).toEqual([]);
    expect(await buscarEnBiblioteca(page, "aguante", [])).toEqual([]);
    // Un símbolo que ya no existe (el libro se borró, el ajuste se quedó).
    expect(await buscarEnBiblioteca(page, "aguante", ["fantasma"])).toEqual([]);
  });

  test("solo se busca en las publicaciones marcadas", async ({ page }) => {
    await abrirApp(page);
    await sembrarBiblioteca(page, [LIBRO_AGUANTE, LIBRO_ORACION]);

    const fragmentos = await buscarEnBiblioteca(page, "aguante", ["cl"]);

    // Las dos publicaciones hablan del aguante; solo "cl" está marcada.
    expect(fragmentos).toHaveLength(1);
    expect(fragmentos[0]!.symbol).toBe("cl");
  });

  test("una biblioteca de 4,5 MB no bloquea la interfaz", async ({ page }) => {
    await abrirApp(page);

    const parrafo = "<p class='p'>Palabras de relleno para medir el coste real. </p>";
    const enorme = publicacion(
      "big",
      "Biblioteca grande",
      Array.from({ length: 300 }, (_, i) => {
        const doc: [number, string, string] = [
          i + 1,
          `Documento ${i + 1}`,
          parrafo.repeat(250) + (i === 280 ? "<p>Aquí sí habla del aguante.</p>" : ""),
        ];
        return doc;
      }),
    );

    const medida = await page.evaluate(async (pub) => {
      const mod = await import("/src/services/localLibrarySearch.ts");
      const bytes = pub.documents.reduce(
        (s: number, d: { Content: string }) => s + d.Content.length,
        0,
      );

      // El bloqueo se mide con un temporizador que DEBERÍA dispararse cada
      // 10 ms: si el hilo principal se queda tomado, deja de correr.
      let latidos = 0;
      const intervalo = setInterval(() => {
        latidos += 1;
      }, 10);
      const inicio = performance.now();
      const encontrados = await mod.searchPublications("aguante", [pub]);
      const ms = performance.now() - inicio;
      clearInterval(intervalo);

      return { ms, bytes, latidos, encontrados: encontrados.length };
    }, enorme);

    console.log(
      `[medición] ${(medida.bytes / 1e6).toFixed(1)} MB de HTML en ` +
        `${medida.ms.toFixed(0)} ms · ${medida.latidos} latidos de 10 ms ` +
        `durante la búsqueda`,
    );

    expect(medida.encontrados).toBe(1);
    // El troceado le devuelve el turno al navegador: el temporizador tiene que
    // haber corrido al menos una vez DURANTE la búsqueda. Sin `await` entre
    // documentos, esto sería 0.
    expect(medida.latidos).toBeGreaterThan(0);
    // Techo generoso a propósito: la máquina de CI es más lenta. Lo que se
    // vigila aquí es que no haya una regresión de orden de magnitud.
    expect(medida.ms).toBeLessThan(5000);
  });
});

// ─── El cableado con el chat ─────────────────────────────────────

test.describe("Elegir libros en Ajustes", () => {
  const irAAjustes = async (page: Page) => {
    await navegacion(page).getByRole("button", { name: "Más" }).click();
    await expect(page.getByRole("heading", { name: "Tus publicaciones" })).toBeVisible();
  };

  test("sin biblioteca, se explica y se enlaza en vez de enseñar una lista vacía", async ({
    page,
  }) => {
    await abrirApp(page);
    await irAAjustes(page);

    await expect(page.getByText(/Todavía no has cargado ninguna publicación/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ir a Biblioteca" })).toBeVisible();
  });

  test("las publicaciones guardadas salen con casilla y la marca se recuerda", async ({
    page,
  }) => {
    await abrirApp(page);
    await sembrarBiblioteca(page, [LIBRO_AGUANTE, LIBRO_ORACION]);
    await irAAjustes(page);

    const casilla = page.getByRole("checkbox", {
      name: /Damos testimonio del Reino de Dios/,
    });
    await expect(casilla).toBeVisible();
    await expect(casilla).not.toBeChecked();

    await casilla.click();
    await expect(casilla).toBeChecked();

    // La advertencia solo aparece cuando hay algo marcado: es lo que se está
    // autorizando, no un texto de ayuda permanente.
    await expect(page.getByText(/Qué implica tener un libro marcado/)).toBeVisible();
    await expect(page.getByText(/SE ENVÍAN al proveedor de IA/)).toBeVisible();

    // Persiste: la elección vive en localStorage, no en el estado de React.
    // Tras recargar, la app reabre donde estabas (uiStore guarda `view`), así
    // que se espera a la navegación y no al composer, que aquí no existe.
    await page.reload();
    await expect(navegacion(page)).toBeVisible();
    await irAAjustes(page);
    await expect(
      page.getByRole("checkbox", { name: /Damos testimonio del Reino de Dios/ }),
    ).toBeChecked();
  });

  test("los fragmentos del libro marcado viajan con la pregunta", async ({ page }) => {
    await abrirApp(page);
    await sembrarBiblioteca(page, [LIBRO_AGUANTE, LIBRO_ORACION]);
    await mockChatStream(page, RESPUESTA_SIMPLE);
    await irAAjustes(page);

    await page.getByRole("checkbox", { name: /Damos testimonio/ }).click();

    const peticiones = captureChatRequests(page);
    await navegacion(page).getByRole("button", { name: "Chat" }).click();
    await enviar(page, "¿Qué dice sobre el aguante?");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    const cuerpo = peticiones[0]!.postDataJSON();
    const fragmentos = cuerpo.local_library;

    expect(Array.isArray(fragmentos)).toBe(true);
    expect(fragmentos.length).toBeGreaterThan(0);
    // Solo del libro marcado, aunque "cl" también hable del aguante.
    expect(fragmentos.every((f: Fragmento) => f.symbol === "bt")).toBe(true);
    expect(fragmentos[0].publication).toBe("Damos testimonio del Reino de Dios");
    expect(fragmentos[0].text).toContain("aguante");
    // Nunca la publicación entera.
    expect(fragmentos[0].text.length).toBeLessThanOrEqual(702);
  });

  test("sin ningún libro marcado el cuerpo sale exactamente como antes", async ({
    page,
  }) => {
    await abrirApp(page);
    await sembrarBiblioteca(page, [LIBRO_AGUANTE]);
    await mockChatStream(page, RESPUESTA_SIMPLE);

    const peticiones = captureChatRequests(page);
    await enviar(page, "¿Qué dice sobre el aguante?");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    // Ni siquiera una lista vacía: la clave no existe.
    expect(peticiones[0]!.postDataJSON()).not.toHaveProperty("local_library");
  });

  test("desmarcar corta el envío", async ({ page }) => {
    await abrirApp(page);
    await sembrarBiblioteca(page, [LIBRO_AGUANTE]);
    await mockChatStream(page, RESPUESTA_SIMPLE);
    await irAAjustes(page);

    const casilla = page.getByRole("checkbox", { name: /Damos testimonio/ });
    await casilla.click();
    await expect(casilla).toBeChecked();
    await casilla.click();
    await expect(casilla).not.toBeChecked();

    const peticiones = captureChatRequests(page);
    await navegacion(page).getByRole("button", { name: "Chat" }).click();
    await enviar(page, "¿Qué dice sobre el aguante?");
    await expect(page.getByText("Respuesta breve de prueba.")).toBeVisible();

    expect(peticiones[0]!.postDataJSON()).not.toHaveProperty("local_library");
  });
});
