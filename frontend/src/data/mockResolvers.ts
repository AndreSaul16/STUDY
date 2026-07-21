/**
 * Mock data para los resolvers del ReferenceEngine.
 *
 * Simula lo que el backend FastAPI + MCP devolvería al resolver una referencia.
 * En la siguiente fase, estos datos se obtendrán via HTTP al endpoint
 * `GET /api/references/{identifier}` que a su vez invocará el MCP.
 *
 * La estructura es un mapa identifier → contenido expandido.
 * Cada resolver accede a la sección que le corresponde.
 */

// ─── Textos bíblicos (scripture) ─────────────────────────────────
export const MOCK_SCRIPTURE_DB: Record<string, { title: string; body: string }> = {
  "scripture:salmo:23:1": {
    title: "Salmo 23:1",
    body: "Jehová es mi pastor; nada me faltará. En lugares de delicados pastos me hará yacer; junto a aguas de reposo me pastoreará. Confortará mi alma; me guiará por sendas de justicia por amor de su nombre. Aunque ande en valle de sombra de muerte, no temeré mal alguno, porque tú estarás conmigo; tu vara y tu cayado me infundirán aliento. Aderezas mesa delante de mí en presencia de mis angustiadores; unges mi cabeza con aceite; mi copa está rebosando. Ciertamente el bien y la misericordia me seguirán todos los días de mi vida, y en la casa de Jehová moraré por largos días.",
  },
  "scripture:salmo:23:all": {
    title: "Salmo 23 (completo)",
    body: "1 Jehová es mi pastor; nada me faltará. 2 En lugares de delicados pastos me hará yacer; junto a aguas de reposo me pastoreará. 3 Confortará mi alma; me guiará por sendas de justicia por amor de su nombre. 4 Aunque ande en valle de sombra de muerte, no temeré mal alguno, porque tú estarás conmigo; tu vara y tu cayado me infundirán aliento. 5 Aderezas mesa delante de mí en presencia de mis angustiadores; unges mi cabeza con aceite; mi copa está rebosando. 6 Ciertamente el bien y la misericordia me seguirán todos los días de mi vida, y en la casa de Jehová moraré por largos días.",
  },
  "scripture:juan:3:16": {
    title: "Juan 3:16",
    body: "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree no se pierda, mas tenga vida eterna. Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él.",
  },
  "scripture:hebreos:11:1": {
    title: "Hebreos 11:1",
    body: "Es, pues, la fe la certeza de lo que se espera, la convicción de lo que no se ve. Por ella alcanzaron buen testimonio los antiguos. Por la fe entendemos haber sido constituido el universo por la palabra de Dios, de modo que lo que se ve fue hecho de lo que no se veía.",
  },
  "scripture:romanos:8:28": {
    title: "Romanos 8:28",
    body: "Y sabemos que a los que aman a Dios, todas las cosas les ayudan a bien, esto es, a los que conforme a su propósito son llamados.",
  },
  "scripture:1 corintios:13:4": {
    title: "1 Corintios 13:4-7",
    body: "El amor es sufrido, es benigno; el amor no tiene envidia, el amor no es jactancioso, no se envanece; no hace nada indebido, no busca lo suyo, no se irrita, no guarda rencor; no se goza de la injusticia, mas se goza de la verdad. Todo lo sufre, todo lo cree, todo lo espera, todo lo soporta.",
  },
  "scripture:génesis:1:1": {
    title: "Génesis 1:1",
    body: "En el principio creó Dios los cielos y la tierra. Y la tierra estaba desordenada y vacía, y las tinieblas estaban sobre la faz del abismo, y el Espíritu de Dios se movía sobre la faz de las aguas.",
  },
  "scripture:mateo:5:3": {
    title: "Mateo 5:3",
    body: "Bienaventurados los pobres en espíritu, porque de ellos es el reino de los cielos.",
  },
};

// ─── Publicaciones (publication) ─────────────────────────────────
export const MOCK_PUBLICATION_DB: Record<string, { title: string; body: string; subtitle?: string }> = {
  "publication:la_atalaya:2023:s.e.": {
    title: "La Atalaya — 2023",
    subtitle: "Edición de estudio",
    body: "La Atalaya es una revista religiosa publicada mensualmente por los Testigos de Jehová. La edición de 2023 contiene artículos de estudio bíblico organizados para reuniones congregacionales. Cada número incluye análisis temático de escrituras, aplicación práctica y preguntas para discusión en grupo.",
  },
  "publication:la_atalaya:2023:7": {
    title: "La Atalaya — Julio 2023",
    subtitle: "Edición de estudio",
    body: "Número de julio 2023. Artículo principal: «¿Está preparado para el fin del mundo?». Estudio basado en Mateo 24:3-14 y la señal de los últimos días. Incluye análisis del cumplimiento profético contemporáneo.",
  },
  "publication:¡despertad!:2022:s.e.": {
    title: "¡Despertad! — 2022",
    subtitle: "Edición para el público general",
    body: "¡Despertad! es una revista bimensual dirigida al público general. Trata temas de interés familiar, social y bíblico desde una perspectiva práctica. La edición de 2022 incluyó series sobre salud mental, educación de hijos y esperanza bíblica.",
  },
  "publication:benefíciese de la escuela del ministerio teocrático:s.a.:s.e.": {
    title: "Benefíciese de la Escuela del Ministerio Teocrático",
    subtitle: "Manual de formación",
    body: "Manual de texto utilizado en la Escuela del Ministerio Teocrático. Cubre técnicas de lectura, oratoria, discursos bíblicos y pastoral. Estructurado en secciones progresivas con ejercicios prácticos.",
  },
};

// ─── Notas del autor (footnote) ──────────────────────────────────
export const MOCK_FOOTNOTE_DB: Record<string, { title: string; body: string }> = {
  "footnote:1": {
    title: "Nota 1 — Vallecito",
    body: "El término hebreo גַּיְא (gay') designa un barranco o wadi. En la poesía sapiencial se convierte en metáfora del peligro y la incertidumbre. La LXX traduce como φάραγξ, barranco profundo.",
  },
  "footnote:2": {
    title: "Nota 2 — Pastor en el antiguo Oriente",
    body: "La figura del pastor era común en la literatura del antiguo Oriente Próximo. En el Código de Hammurabi (§44-47) se regulan los derechos y deberes de los pastores. En Egipto, el faraón era llamado «pastor de su pueblo».",
  },
  "footnote:3": {
    title: "Nota 3 — La vara y el cayado",
    body: "La vara (hebreo shevet) era un bastón corto y grueso, usado para defender al rebaño de depredadores. El cayado (hebreo mish'enet) era más largo, con extremo curvado, usado para rescatar ovejas de grietas y guiarlas. Ambos instrumentos aparecen en representaciones egipcias del tercer milenio a.C.",
  },
};

// ─── Referencias cruzadas (cross_reference) ──────────────────────
export const MOCK_CROSSREF_DB: Record<string, { title: string; body: string }> = {
  "crossref:salmo_23:1": {
    title: "Referencia cruzada — Salmo 23:1",
    body: "Pasaje paralelo al tema del pastor divino. Compárese con Isaías 40:11 («como pastor apacentará su rebaño») y Ezequiel 34:15 («yo mismo apacentaré mis ovejas»). El tema del pastor se desarrolla a lo largo del salterio y los profetas.",
  },
  "crossref:juan_3:16": {
    title: "Referencia cruzada — Juan 3:16",
    body: "Texto central del evangelio de Juan. Paralelos temáticos con 1 Juan 4:9 («en esto se mostró el amor de Dios») y Romanos 5:8 («Dios muestra su amor para con nosotros»). La frase «Hijo unigénito» (monogenēs) aparece también en Juan 1:14 y 1:18.",
  },
};

// ─── Fallback genérico ───────────────────────────────────────────
export const MOCK_FALLBACK = {
  title: "Referencia sin resolver",
  body: "Esta referencia no tiene contenido expandido en el mock actual. En producción, el backend FastAPI la resolvería via MCP.",
};
