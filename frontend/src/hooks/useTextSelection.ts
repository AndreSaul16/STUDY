import { useEffect, useRef, useState, useCallback } from "react";
import type { SelectionRange } from "@/types/domain";

interface UseTextSelectionOptions {
  /** Selector del contenedor donde escuchar selecciones */
  containerSelector?: string;
  /** Data attribute que identifica el bloque (ej: "data-block-id") */
  blockAttr?: string;
}

interface UseTextSelectionReturn {
  /** Selección actual o null si no hay */
  selection: SelectionRange | null;
  /** Limpia la selección activa */
  clearSelection: () => void;
}

/**
 * useTextSelection — detecta selección de texto dentro de un contenedor
 * y la mapea a un SelectionRange con blockId y offsets.
 *
 * Requisitos del DOM:
 *  - El contenedor debe tener el selector indicado.
 *  - Cada bloque de texto debe tener data-block-id="{n}".
 *  - El texto seleccionado debe estar dentro de un único bloque.
 */
export function useTextSelection({
  containerSelector = "[data-reader-content]",
  blockAttr = "data-block-id",
}: UseTextSelectionOptions = {}): UseTextSelectionReturn {
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const handleSelectionChange = () => {
      // Debounce — la selección nativa dispara muchos eventos
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelection(null);
          return;
        }

        const range = sel.getRangeAt(0);
        if (!range) return;

        // El contenedor debe contener el range
        if (!container.contains(range.commonAncestorContainer)) {
          setSelection(null);
          return;
        }

        // Buscar el bloque ancestro con data-block-id
        let node: Node | null = range.commonAncestorContainer;
        let blockId: number | null = null;

        if (node.nodeType === Node.TEXT_NODE) {
          node = node.parentElement;
        }

        while (node && node !== container) {
          if (
            node instanceof HTMLElement &&
            node.hasAttribute(blockAttr)
          ) {
            blockId = Number(node.getAttribute(blockAttr));
            break;
          }
          node = node.parentElement;
        }

        if (blockId === null) {
          setSelection(null);
          return;
        }

        // Solo selecciones dentro de un único bloque
        const blockEl = (node as HTMLElement | null)?.closest(
          `[${blockAttr}="${blockId}"]`,
        );
        if (!blockEl || !blockEl.contains(range.commonAncestorContainer)) {
          setSelection(null);
          return;
        }

        const selectedText = sel.toString().trim();
        if (selectedText.length < 2) {
          setSelection(null);
          return;
        }

        // Calcular offsets relativos al contenido de texto del bloque.
        //
        // NOTA (B9): Cuando hay highlights aplicados, los text nodes se particionan
        // y getOffsetWithin camina todos los text nodes del bloque. Esto produce
        // offsets relativos al texto concatenado del bloque, que es lo correcto
        // para el modelo de datos (annotations guardan offsets sobre texto plano).
        //
        // Edge case: si el usuario selecciona a través de un highlight existente,
        // el range puede abarcar múltiples text nodes + elementos highlight.
        // getOffsetWithin maneja esto caminando todos los text nodes, pero
        // el offset calculado puede no coincidir exactamente con selectedText
        // si hay espacios colapsados. Aceptamos esta imprecisión para v1;
        // una solución exacta requeriría normalizar el DOM antes de medir.
        const blockRange = document.createRange();
        blockRange.selectNodeContents(blockEl);
        const startOffset =
          range.startOffset +
          getOffsetWithin(
            blockRange.startContainer,
            range.startContainer,
            blockEl as HTMLElement,
          );
        const endOffset =
          range.endOffset +
          getOffsetWithin(
            blockRange.endContainer,
            range.endContainer,
            blockEl as HTMLElement,
          );

        // Guard: offsets inválidos (selection fuera de rango o DOM corrupto)
        const blockTextLen = blockEl.textContent?.length ?? 0;
        if (
          startOffset < 0 ||
          endOffset < startOffset ||
          endOffset > blockTextLen
        ) {
          setSelection(null);
          return;
        }

        const rect = range.getBoundingClientRect();

        setSelection({
          blockId,
          startOffset,
          endOffset,
          selectedText,
          rect,
        });
      }, 180);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [containerSelector, blockAttr]);

  return { selection, clearSelection };
}

/**
 * Calcula el offset acumulado de texto hasta un nodo dentro de un contenedor.
 * Necesario porque los highlights particionan el texto en múltiples text nodes.
 */
function getOffsetWithin(
  _root: Node,
  target: Node,
  container: HTMLElement,
): number {
  if (target === container) return 0;

  let offset = 0;
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let current: Node | null = walker.currentNode;
  while (current) {
    if (current === target) break;
    if (
      current.nodeType === Node.TEXT_NODE &&
      current.textContent
    ) {
      offset += current.textContent.length;
    }
    current = walker.nextNode();
  }

  return offset;
}
