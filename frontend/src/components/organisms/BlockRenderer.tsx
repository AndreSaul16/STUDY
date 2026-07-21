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

/**
 * Valida que un src de imagen sea seguro: solo `data:image/...` o rutas
 * relativas. Rechaza esquemas (http:, javascript:, etc.) y protocol-relative.
 */
function isSafeImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("data:image/")) return true;
  if (s.startsWith("//")) return false; // protocol-relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false; // cualquier esquema
  return true; // ruta relativa
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
    const safe = isSafeImageSrc(url);
    return (
      <figure data-block-id={block.blockId} className="my-6">
        {safe && (
          <img
            src={url}
            alt={alt}
            className="w-full rounded-lg ring-1 ring-seam-light dark:ring-seam-dark"
          />
        )}
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
  | { kind: "marked"; text: string; color: HighlightColor; note: string | null; ref?: DetectedReference };

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
            {seg.ref ? (
              <ReferenceChip
                reference={seg.ref.reference}
                onClick={() => onOpenReference(seg.ref!.reference)}
                label={seg.text}
              />
            ) : seg.text}
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
 * Las fronteras de todos los rangos dividen el texto en intervalos. Así se
 * mantienen los highlights solapados y una referencia sigue siendo clicable
 * aunque esté parcialmente marcada.
 */
function buildSegments(
  text: string,
  detected: DetectedReference[],
  annotations: Annotation[],
): Segment[] {
  const boundaries = new Set<number>([0, text.length]);
  const validAnnotations = annotations.filter(
    (annotation) => annotation.startOffset >= 0 && annotation.endOffset > annotation.startOffset && annotation.endOffset <= text.length,
  );
  for (const reference of detected) {
    boundaries.add(Math.max(0, reference.start));
    boundaries.add(Math.min(text.length, reference.end));
  }
  for (const annotation of validAnnotations) {
    boundaries.add(annotation.startOffset);
    boundaries.add(annotation.endOffset);
  }
  const positions = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index]!;
    const end = positions[index + 1]!;
    if (start === end) continue;
    const annotation = validAnnotations
      .filter((candidate) => candidate.startOffset <= start && candidate.endOffset >= end)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const reference = detected.find((candidate) => candidate.start <= start && candidate.end >= end);
    const segmentText = text.slice(start, end);
    if (annotation) {
      segments.push({ kind: "marked", text: segmentText, color: annotation.color, note: annotation.note, ...(reference ? { ref: reference } : {}) });
    } else if (reference) {
      segments.push({ kind: "reference", text: segmentText, ref: reference });
    } else {
      segments.push({ kind: "plain", text: segmentText });
    }
  }

  return segments;
}
