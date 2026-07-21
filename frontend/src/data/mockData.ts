import type {
  Article,
  CrossReference,
  ReferenceContent,
} from "@/types/domain";

/**
 * Mock de referencias cruzadas — simula lo que el backend MCP devolvería
 * al pulsar una referencia. La latencia simulada vive en el store.
 */
const REFERENCE_DB: Record<string, ReferenceContent> = {
  "ref-sal-23-1": {
    title: "Salmo 23:1",
    body: "Jehová es mi pastor; nada me faltará. En lugares de delicados pastos me hará yacer; junto a aguas de reposo me pastoreará. Confortará mi alma; me guiará por sendas de justicia por amor de su nombre. Aunque ande en valle de sombra de muerte, no temeré mal alguno, porque tú estarás conmigo; tu vara y tu cayado me infundirán aliento. Aderezas mesa delante de mí en presencia de mis angustiadores; unges mi cabeza con aceite; mi copa está rebosando. Ciertamente el bien y la misericordia me seguirán todos los días de mi vida, y en la casa de Jehová moraré por largos días.",
  },
  "ref-juan-3-16": {
    title: "Juan 3:16",
    body: "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree no se pierda, mas tenga vida eterna. Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él.",
  },
  "ref-fe-heb-11": {
    title: "Hebreos 11:1",
    body: "Es, pues, la fe la certeza de lo que se espera, la convicción de lo que no se ve. Por ella alcanzaron buen testimonio los antiguos. Por la fe entendemos haber sido constituido el universo por la palabra de Dios, de modo que lo que se ve fue hecho de lo que no se veía.",
  },
  "ref-glos-pastor": {
    title: "Pastor (Glosario)",
    body: "Del hebreo רָעָה (ra'ah), apacentar. Figura usada en el antiguo Oriente Próximo para denotar al líder que provee, protege y guía. En el salterio, aplica tanto a Jehová como al rey davídico, y más tarde al Mesías esperado.",
  },
  "ref-nota-1": {
    title: "Nota al pie — Vallecito",
    body: "El término hebreo גַּיְא (gay') designa un barranco o wadi. En la poesía sapiencial se convierte en metáfora del peligro y la incertidumbre. La LXX traduce como φάραγξ, barranco profundo.",
  },
};

export const MOCK_REFERENCES: CrossReference[] = [
  {
    id: "ref-sal-23-1",
    label: "Salmo 23:1",
    kind: "scripture",
    sourceBlockId: 3,
    expandedContent: REFERENCE_DB["ref-sal-23-1"]!,
  },
  {
    id: "ref-glos-pastor",
    label: "Glosario: Pastor",
    kind: "glossary",
    sourceBlockId: 3,
    expandedContent: REFERENCE_DB["ref-glos-pastor"]!,
  },
  {
    id: "ref-juan-3-16",
    label: "Juan 3:16",
    kind: "scripture",
    sourceBlockId: 5,
    expandedContent: REFERENCE_DB["ref-juan-3-16"]!,
  },
  {
    id: "ref-fe-heb-11",
    label: "Hebreos 11:1",
    kind: "scripture",
    sourceBlockId: 6,
    expandedContent: REFERENCE_DB["ref-fe-heb-11"]!,
  },
  {
    id: "ref-nota-1",
    label: "Nota: Vallecito",
    kind: "footnote",
    sourceBlockId: 7,
    expandedContent: REFERENCE_DB["ref-nota-1"]!,
  },
];

/**
 * Mock del artículo — simula la salida del adapter _adapt_article
 * del MCPContentService. blockType ya viene normalizado.
 */
export const MOCK_ARTICLE: Article = {
  documentId: 502012345,
  title: "El Pastor que Conforta — Un Estudio del Salmo 23",
  blocks: [
    {
      blockId: 1,
      blockType: "title",
      content: "El Pastor que Conforta",
    },
    {
      blockId: 2,
      blockType: "chapter",
      content: "Capítulo I — La Metáfora del Pastor",
    },
    {
      blockId: 3,
      blockType: "paragraph",
      content:
        "El Salmo 23 es quizá el pasaje más reconocido del salterio davídico. En seis versículos condensa una teología pastoral que ha consolado a generaciones. David, que en su juventud cuidó ovejas en las colinas de Belén, toma esa experiencia y la eleva a metáfora teológica: Jehová es mi pastor. La imagen no es decorativa; es estructural. Define la relación entera entre el creyente y su Dios.",
    },
    {
      blockId: 4,
      blockType: "paragraph",
      content:
        "El primer versículo establece el tono. No dice «un pastor» ni «el pastor», sino mi pastor. Ese pronombre posesivo es la llave hermenéutica del salmo. La fe que aquí se confiesa no es abstracta: es personal, relacional, íntima. Y la consecuencia inmediata es una negación categórica: nada me faltará.",
    },
    {
      blockId: 5,
      blockType: "chapter",
      content: "Capítulo II — Aguas de Reposo",
    },
    {
      blockId: 6,
      blockType: "paragraph",
      content:
        "El versículo segundo despliega dos imágenes complementarias: pastos delicados y aguas de reposo. Las ovejas, a diferencia del ganado vacuno, no pueden comer y huir al mismo tiempo. Necesitan quietud para rumiar. Por eso el pastor las conduce primero a un prado seguro, donde el pasto es tierno y abundante. Solo cuando están saciadas las lleva al agua. El reposo no es un lujo; es una condición fisiológica.",
    },
    {
      blockId: 7,
      blockType: "paragraph",
      content:
        "Las aguas de reposo son aquellas que corren lo bastante para ser frescas pero no tanto como para asustar a la oveja. Un torrente impetuoso, aunque cristalino, es inútil para un rebaño sediento. El pastor conoce el carácter de sus ovejas y elige la fuente adecuada. Así obra la providencia: no siempre nos da lo más espectacular, sino lo más apropiado.",
    },
    {
      blockId: 8,
      blockType: "chapter",
      content: "Capítulo III — El Valle de Sombra",
    },
    {
      blockId: 9,
      blockType: "paragraph",
      content:
        "El salmo no evita la oscuridad. Al contrario, la enfrenta con realismo poético. Aunque ande en valle de sombra de muerte, no temeré mal alguno. La sombra, en la Biblia, es símbolo de amenaza y de misterio. Pero una sombra, por definición, no tiene sustancia propia: requiere una luz que la proyecte. Donde hay sombra de muerte, hay también una luz que el salmista intuye.",
    },
    {
      blockId: 10,
      blockType: "paragraph",
      content:
        "La presencia del pastor no elimina el valle; lo transforma. Tu vara y tu cayado me infundirán aliento. La vara era un bastón corto, grueso, usado para defender al rebaño de los depredadores. El cayado, más largo y curvado en su extremo, servía para rescatar ovejas extraviadas y guiarlas de vuelta. Dos instrumentos, dos funciones: protección y rescate. El salmista los menciona juntos porque ambos son necesarios.",
    },
    {
      blockId: 11,
      blockType: "chapter",
      content: "Capítulo IV — La Mesa Aderezada",
    },
    {
      blockId: 12,
      blockType: "paragraph",
      content:
        "El cuarto versículo introduce un cambio dramático de escenario. Deja el prado y el valle, y entra en un banquete. Aderezas mesa delante de mí en presencia de mis angustiadores. La imagen es audaz: un festín preparado a la vista de los enemigos. No es una huida del peligro, sino una victoria proclamada en su misma presencia.",
    },
    {
      blockId: 13,
      blockType: "paragraph",
      content:
        "La unción con aceite era señal de hospitalidad y de honor en el antiguo Oriente. Un huésped distinguido recibía aceite perfumado sobre su cabeza al entrar en la tienda. Mi copa está rebosando: no simplemente llena, sino desbordada. La generosidad del anfitrión es desmedida, intencionalmente excesiva.",
    },
    {
      blockId: 14,
      blockType: "chapter",
      content: "Capítulo V — La Casa del Señor",
    },
    {
      blockId: 15,
      blockType: "paragraph",
      content:
        "El salmo cierra con una afirmación de permanencia. Ciertamente el bien y la misericordia me seguirán todos los días de mi vida. El verbo hebreo detrás de seguir es radaf, que normalmente significa perseguir. La gracia no camina detrás a distancia: persigue, alcanza, no suelta. Y la morada final no es temporal sino indefinida: en la casa de Jehová moraré por largos días.",
    },
    {
      blockId: 16,
      blockType: "paragraph",
      content:
        "Así, en seis versículos, el salmista recorre un arco completo: de la provisión cotidiana al banquete victorioso, del prado al templo, del pastor al anfitrión. Cada imagen se construye sobre la anterior sin contradecirla. La fe que empieza reconociendo al pastor termina habitando en su casa.",
    },
  ],
};

/** Referencias indexadas por sourceBlockId para lookup O(1) */
export const REFERENCES_BY_BLOCK: Record<number, CrossReference[]> =
  MOCK_REFERENCES.reduce((acc, ref) => {
    (acc[ref.sourceBlockId] ??= []).push(ref);
    return acc;
  }, {} as Record<number, CrossReference[]>);

/** Lookup por id */
export const REFERENCES_BY_ID: Record<string, CrossReference> =
  Object.fromEntries(MOCK_REFERENCES.map((r) => [r.id, r]));
