import { useMemo } from "react";
import type { PublicationBlock, Annotation, HighlightColor } from "@/types/domain";
import { BLOCK_TYPES, HIGHLIGHT_COLORS } from "@/types/domain";
import { cn } from "@/utils/cn";
import { ReferenceChip } from "@/components/molecules/ReferenceCard";
import { useReferenceEngine } from "@/hooks/useReferenceEngine";
import type { DetectedReference } from "@/types/reference";

interface BlockRendererProps {
  block: PublicationBlock;
  annotations: Annotation[];
}

const MARK_BG: Record<HighlightColor, string> = {
  [HIGHLIGHT_COLORS.YELLOW]: "bg-mark-yellow/60",
  [HIGHLIGHT_COLORS.GREEN]: "bg-mark-green/60",
  [HIGHLIGHT_COLORS.BLUE]: "bg-mark-blue/60",
  [HIGHLIGHT_COLORS.PINK]: "bg-mark-pink/60",
  [HIGHLIGHT_COLORS.ORANGE]: "bg-mark-orange/60",
};

/**
 * BlockRenderer — renderiza un PublicationBlock con:
 *  - Tipografía semántica (title, chapter, paragraph, image)
 *  - Highlights sobre los rangos anotados
 *  - **Detección automática de referencias** via ReferenceEngine
 *  - Chips inline clicables para cada referencia detectada
 *
 * Flujo de detección:
 *  1. El engine.detect(content) devuelve DetectedReference[] con posiciones
 *  2. El texto se particiona en segmentos: plano | referencia | anotado
 *  3. Las referencias se renderizan como ReferenceChip clicables
 *  4. Al pulsar, useReferenceEngine.openReference() resuelve y actualiza el panel derecho
 */
export function BlockRenderer({
  block,
  annotations,
}: BlockRendererProps) {
  const { detectReferences, openReference } = useReferenceEngine();

  // Detectar referencias en el contenido del bloque
  const detected = useMemo(
    () => detectReferences(block.content),
    [block.content, detectReferences],
  );

  if (block.blockType === BLOCK_TYPES.TITLE) {
    return (
      <h1
        data-block-id={block.blockId}
        className="font-display text-4xl leading-[1.1] text-reading-light dark:text-reading-dark sm:text-5xl"
      >
        {block.content}
      </h1>
    );
  }

  if (block.blockType === BLOCK_TYPES.CHAPTER) {
    return (
      <h2
        data-block-id={block.blockId}
        className={cn(
          "mt-10 font-display text-2xl leading-tight",
          "text-amber-800 dark:text-amber-400",
          "first:mt-0",
        )}
      >
        {block.content}
      </h2>
    );
  }

  if (block.blockType === BLOCK_TYPES.IMAGE) {
    const match = block.content.match(/^!\[(.*?)\]\((.*?)\)$/);
    const alt = match?.[1] ?? "";
    const url = match?.[2] ?? "";
    return (
      <figure data-block-id={block.blockId} className="my-6">
        <img
          src={url}
          alt={alt}
          className="w-full rounded-lg ring-1 ring-seam-light dark:ring-seam-dark"
        />
        {alt && (
          <figcaption className="mt-2 text-center font-ui text-xs italic text-muted-light dark:text-muted-dark">
            {alt}
          </figcaption>
        )}
      </figure>
    );
  }

  // ─── Párrafo: texto + anotaciones + referencias detectadas ────
  return (
    <p
      data-block-id={block.blockId}
      className="prose-reading text-reading-light dark:text-reading-dark"
    >
      <RenderedText
        content={block.content}
        detected={detected}
        annotations={annotations}
        onOpenReference={openReference}
      />
    </p>
  );
}

// ─── Renderizado con segmentación ────────────────────────────────

type Segment =
  | { kind: "plain"; text: string }
  | { kind: "reference"; text: string; ref: DetectedReference }
  | { kind: "marked"; text: string; color: HighlightColor; note: string | null };

interface RenderedTextProps {
  content: string;
  detected: DetectedReference[];
  annotations: Annotation[];
  onOpenReference: (ref: DetectedReference["reference"]) => void;
}

/**
 * RenderedText — particiona el texto en segmentos combinando
 * referencias detectadas y anotaciones de highlights.
 *
 * Estrategia: merge de dos listas de rangos (detected + annotations)
 * ordenadas por posición, generando segmentos no solapados.
 */
function RenderedText({
  content,
  detected,
  annotations,
  onOpenReference,
}: RenderedTextProps) {
  const segments = useMemo(
    () => buildSegments(content, detected, annotations),
    [content, detected, annotations],
  );

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "plain") {
          return <span key={i}>{seg.text}</span>;
        }

        if (seg.kind === "reference") {
          return (
            <ReferenceChip
              key={i}
              reference={seg.ref.reference}
              onClick={() => onOpenReference(seg.ref.reference)}
            />
          );
        }

        // marked (highlight)
        return (
          <span
            key={i}
            className={cn(
              "relative rounded-sm bg-[length:100%_45%] bg-no-repeat bg-[position:0_88%]",
              MARK_BG[seg.color],
            )}
          >
            {seg.text}
            {seg.note && (
              <button
                aria-label="Ver nota"
                className="ml-0.5 inline-flex h-4 w-4 -translate-y-1 items-center justify-center rounded-full bg-amber-700 text-[8px] font-bold text-paper-50 align-baseline"
                title={seg.note}
              >
                ✦
              </button>
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * Construye segmentos combinando referencias detectadas y anotaciones.
 * Prioridad: anotaciones > referencias > texto plano.
 * Si solapan, gana la anotación (el highlight es más explícito).
 */
function buildSegments(
  text: string,
  detected: DetectedReference[],
  annotations: Annotation[],
): Segment[] {
  // Crear puntos de corte
  type Cut = { pos: number; type: "ref-start" | "ref-end" | "ann-start" | "ann-end"; data: unknown };
  const cuts: Cut[] = [];

  for (const d of detected) {
    cuts.push({ pos: d.start, type: "ref-start", data: d });
    cuts.push({ pos: d.end, type: "ref-end", data: d });
  }

  for (const a of annotations) {
    if (a.startOffset < 0 || a.endOffset > text.length) continue;
    cuts.push({ pos: a.startOffset, type: "ann-start", data: a });
    cuts.push({ pos: a.endOffset, type: "ann-end", data: a });
  }

  // Ordenar cortes por posición
  cuts.sort((a, b) => a.pos - b.pos);

  const segments: Segment[] = [];
  let cursor = 0;
  let activeRef: DetectedReference | null = null;
  let activeAnn: Annotation | null = null;

  for (const cut of cuts) {
    // Texto plano antes del corte
    if (cut.pos > cursor) {
      if (activeAnn) {
        segments.push({
          kind: "marked",
          text: text.slice(cursor, cut.pos),
          color: activeAnn.color,
          note: activeAnn.note,
        });
      } else if (activeRef) {
        segments.push({
          kind: "reference",
          text: text.slice(cursor, cut.pos),
          ref: activeRef,
        });
      } else {
        segments.push({ kind: "plain", text: text.slice(cursor, cut.pos) });
      }
    }

    cursor = cut.pos;

    // Procesar corte
    if (cut.type === "ref-start") {
      activeRef = cut.data as DetectedReference;
    } else if (cut.type === "ref-end") {
      activeRef = null;
    } else if (cut.type === "ann-start") {
      activeAnn = cut.data as Annotation;
      activeRef = null; // anotación tiene prioridad
    } else if (cut.type === "ann-end") {
      activeAnn = null;
    }
  }

  // Resto del texto
  if (cursor < text.length) {
    segments.push({ kind: "plain", text: text.slice(cursor) });
  }

  return segments;
}
