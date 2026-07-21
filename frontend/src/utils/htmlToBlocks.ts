/**
 * htmlToBlocks — parser de HTML de JWPUB a PublicationBlock[].
 *
 * El HTML interno de JWPUB tiene esta estructura:
 *   <p id="p1" data-pid="1">Texto del párrafo</p>
 *   <h1>Título</h1>
 *   <h2>Capítulo</h2>
 *   <a href="jwpub://b/NWTR/19:23:1" class="b">Salmo 23:1</a>
 *
 * Convertimos cada elemento a un PublicationBlock con blockType semántico.
 */

import type { PublicationBlock } from "@/types/domain";
import { BLOCK_TYPES } from "@/types/domain";

/**
 * Parsea HTML de JWPUB a PublicationBlock[].
 * Usa DOMParser (disponible en browser).
 */
export function htmlToBlocks(html: string, startBlockId = 0): PublicationBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const blocks: PublicationBlock[] = [];
  let blockId = startBlockId;

  // Iterar sobre todos los elementos del body
  const body = doc.body;
  // Bloques hoja que emitimos directamente.
  const LEAF_BLOCKS = ["p", "h1", "h2", "h3", "li", "img"];
  // Contenedores: descendemos a sus hijos (FILTER_SKIP) en lugar de emitirlos,
  // para no duplicar el texto (contenedor + hijo).
  const CONTAINERS = ["div", "ul", "ol", "figure", "blockquote"];

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
      const tag = node.tagName.toLowerCase();
      if (LEAF_BLOCKS.includes(tag)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      // div/blockquote "hoja" (sin bloques hijos): aceptar para no perder su texto.
      if (tag === "div" || tag === "blockquote") {
        const hasBlockChildren = node.querySelector(
          [...LEAF_BLOCKS, ...CONTAINERS].join(","),
        );
        if (!hasBlockChildren && (node.textContent?.trim() ?? "")) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      // Resto de contenedores (ul, ol, figure, …) → descender sin emitir.
      return NodeFilter.FILTER_SKIP;
    },
  });

  const elements: Element[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Element) {
      elements.push(current);
    }
    current = walker.nextNode();
  }

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim() ?? "";

    if (!text && tag !== "img") continue;

    let blockType: PublicationBlock["blockType"] = BLOCK_TYPES.PARAGRAPH;
    let content = text;

    if (tag === "h1") {
      blockType = BLOCK_TYPES.TITLE;
    } else if (tag === "h2" || tag === "h3") {
      blockType = BLOCK_TYPES.CHAPTER;
    } else if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      blockType = BLOCK_TYPES.IMAGE;
      content = `![${alt}](${src})`;
    } else if (tag === "blockquote") {
      blockType = BLOCK_TYPES.PARAGRAPH;
      content = text;
    } else if (tag === "p") {
      // Usar textContent (no innerHTML) — el contenido se renderiza como texto
      // seguro; las referencias se detectan sobre el texto.
      content = text;
      blockType = BLOCK_TYPES.PARAGRAPH;
    } else if (tag === "li" || tag === "ul" || tag === "ol") {
      // Listas → párrafos individuales
      content = text;
      blockType = BLOCK_TYPES.PARAGRAPH;
    } else if (tag === "div") {
      // Divs → párrafos si tienen texto
      content = text;
      blockType = BLOCK_TYPES.PARAGRAPH;
    }

    if (content) {
      blocks.push({
        blockId: blockId++,
        blockType,
        content,
      });
    }
  }

  // Si no se encontró nada, devolver el HTML como un solo bloque
  if (blocks.length === 0 && html.trim()) {
    blocks.push({
      blockId: blockId,
      blockType: BLOCK_TYPES.PARAGRAPH,
      content: html,
    });
  }

  return blocks;
}

/**
 * Convierte un JWPUBDocument (con HTML) a un Article para el reader.
 */
export function jwpubDocumentToArticle(
  doc: { DocumentId: number; Title: string; Content: string },
  publicationSymbol?: string,
): { documentId: number; publicationSymbol?: string; title: string; blocks: PublicationBlock[] } {
  const blocks = htmlToBlocks(doc.Content);
  return {
    documentId: doc.DocumentId,
    publicationSymbol,
    title: doc.Title,
    blocks,
  };
}
