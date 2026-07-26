/**
 * Adaptadores a `Article` — la unidad única que consume el lector.
 *
 * El lector (ReaderPanel + BlockRenderer + anotaciones + detección de
 * referencias) sabe leer una sola cosa: un `Article` con bloques. Todo lo que
 * se puede abrir se normaliza aquí, de modo que subrayar, anotar y detectar
 * citas funciona igual venga de donde venga:
 *
 *   capítulo bíblico (WOL)  → bibleChapterToArticle
 *   artículo de WOL         → wolDocumentToArticle
 *   documento .jwpub        → jwpubDocumentToArticle (en htmlToBlocks.ts)
 *   texto del día           → dailyTextToArticle
 *
 * `documentId` debe ser estable entre sesiones: es parte de la clave con la
 * que se guardan las anotaciones en SQLite. Por eso se derivan de datos
 * inmutables (nº de libro y capítulo, doc_id de WOL, fecha), nunca de un
 * contador de sesión.
 */

import type { Article, PublicationBlock, BlockType } from "@/types/domain";
import { BLOCK_TYPES } from "@/types/domain";
import type { BibleChapter } from "@/services/bibleClient";
import type { WolDocument } from "@/services/referenceClient";
import type { DailyText } from "@/services/jwDailyClient";

/** Símbolos de publicación usados como espacio de nombres de anotaciones. */
export const PUBLICATION_KEYS = {
  BIBLE: "nwt",
  WOL: "wol",
  DAILY: "es",
} as const;

/** Tipos de bloque que emite el backend de WOL → tipos del dominio. */
const WOL_BLOCK_TYPES: Record<string, BlockType> = {
  title: BLOCK_TYPES.TITLE,
  heading: BLOCK_TYPES.HEADING,
  scripture: BLOCK_TYPES.SCRIPTURE,
  question: BLOCK_TYPES.QUESTION,
  caption: BLOCK_TYPES.CAPTION,
  paragraph: BLOCK_TYPES.PARAGRAPH,
};

/**
 * Capítulo bíblico → Article, un bloque por versículo.
 *
 * Un bloque por versículo (y no el capítulo entero en uno) es lo que permite
 * subrayar y anotar versículo a versículo.
 */
export function bibleChapterToArticle(chapter: BibleChapter): Article {
  const blocks: PublicationBlock[] = [
    {
      blockId: 0,
      blockType: BLOCK_TYPES.TITLE,
      content: chapter.title,
    },
    ...chapter.verses.map((verse) => ({
      // El nº de versículo ES el blockId: estable entre cargas, así las
      // anotaciones vuelven a su sitio exacto.
      blockId: verse.verse,
      blockType: BLOCK_TYPES.VERSE,
      content: verse.text,
    })),
  ];

  return {
    // bookNumber * 1000 + chapter → identificador estable y sin colisiones
    // (ningún libro pasa de 150 capítulos).
    documentId: chapter.book_number * 1000 + chapter.chapter,
    publicationSymbol: PUBLICATION_KEYS.BIBLE,
    title: chapter.title,
    blocks,
  };
}

/** Artículo de la Biblioteca en Línea → Article. */
export function wolDocumentToArticle(doc: WolDocument): Article {
  const blocks: PublicationBlock[] = doc.blocks.map((block) => ({
    blockId: block.block_id,
    blockType: WOL_BLOCK_TYPES[block.block_type] ?? BLOCK_TYPES.PARAGRAPH,
    content: block.content,
  }));

  return {
    documentId: doc.doc_id,
    publicationSymbol: doc.citation || PUBLICATION_KEYS.WOL,
    title: doc.title,
    blocks,
  };
}

/** Texto del día → Article, para poder leerlo y anotarlo como cualquier otro. */
export function dailyTextToArticle(daily: DailyText): Article {
  const blocks: PublicationBlock[] = [
    { blockId: 0, blockType: BLOCK_TYPES.TITLE, content: daily.date_label },
    { blockId: 1, blockType: BLOCK_TYPES.SCRIPTURE, content: daily.theme_text },
    { blockId: 2, blockType: BLOCK_TYPES.PARAGRAPH, content: daily.body },
  ];

  return {
    // La fecha como YYYYMMDD: estable y único por día.
    documentId: Number(daily.date_iso.replaceAll("-", "")),
    publicationSymbol: PUBLICATION_KEYS.DAILY,
    title: `Texto del día · ${daily.date_label}`,
    blocks,
  };
}
