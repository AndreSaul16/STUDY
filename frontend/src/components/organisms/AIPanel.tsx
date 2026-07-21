import { useState, useMemo } from "react";
import { cn } from "@/utils/cn";
import { useAIStream, buildAIContext } from "@/hooks/useAIStream";
import { useReaderStore } from "@/store/readerStore";
import { useReferenceEngine } from "@/hooks/useReferenceEngine";
import { SKILLS_METADATA, STREAM_STATES, AI_SKILLS } from "@/types/ai";
import type { AISkill } from "@/types/ai";
import { Button } from "@/components/atoms/Button";
import { Badge } from "@/components/atoms/Badge";
import { Divider } from "@/components/atoms/Divider";
import {
  IconClose,
  IconArrowDown,
} from "@/components/atoms/Icons";

interface AIPanelProps {
  className?: string;
}

/**
 * AIPanel — panel de análisis con IA con streaming progresivo.
 *
 * Muestra:
 *  - Selector de skills (7 tareas)
 *  - Botón ejecutar
 *  - Streaming de tokens en tiempo real (cursor parpadeante)
 *  - Resultados cacheados por skill
 *  - Estado de carga, error y cancelación
 */
export function AIPanel({ className }: AIPanelProps) {
  const {
    streamState,
    activeSkill,
    streamingContent,
    metadata,
    error,
    results,
    execute,
    cancel,
    isStreaming,
    hasResult,
  } = useAIStream();

  const article = useReaderStore((s) => s.article);
  const { activeReference, resolvedContent } = useReferenceEngine();

  // Bloque foco por defecto: el primer párrafo del artículo
  // (en producción, sería el bloque visible/leccionado)
  const focusBlockId = useMemo(() => {
    if (article.blocks.length === 0) return null;
    const firstParagraph = article.blocks.find(
      (b) => b.blockType === "paragraph",
    );
    return firstParagraph?.blockId ?? article.blocks[0]!.blockId;
  }, [article]);

  const [selectedSkill, setSelectedSkill] = useState<AISkill>(AI_SKILLS.SUMMARY);

  const handleExecute = async () => {
    if (focusBlockId === null) return; // Sin bloques → no hay contexto
    const context = buildAIContext({
      article,
      focusBlockId,
      windowSize: 2,
      activeReferences: activeReference
        ? [
            {
              identifier: activeReference.identifier,
              label: activeReference.publication ?? activeReference.identifier,
              type: activeReference.type,
              resolvedContent: resolvedContent?.body ?? null,
            },
          ]
        : [],
    });
    await execute(selectedSkill, context);
  };

  const currentResult = activeSkill ? results[activeSkill] : undefined;
  const displayContent = isStreaming ? streamingContent : currentResult?.content;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* ─── Selector de skills ─── */}
      <div className="shrink-0 space-y-2 p-4">
        <p className="font-ui text-[10px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
          Tarea de análisis
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {SKILLS_METADATA.map((skill) => (
            <button
              key={skill.id}
              onClick={() => setSelectedSkill(skill.id)}
              disabled={isStreaming}
              className={cn(
                "rounded-md px-2.5 py-2 text-left",
                "font-ui text-xs transition-colors",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                selectedSkill === skill.id
                  ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600 dark:bg-amber-800/20 dark:text-amber-300"
                  : "bg-paper-100 text-reading-light/70 hover:bg-paper-200 dark:bg-ink-50 dark:text-reading-dark/70 dark:hover:bg-ink-300",
              )}
            >
              <span className="block font-medium">{skill.label}</span>
              <span className="mt-0.5 block text-[10px] text-muted-light dark:text-muted-dark">
                {skill.description}
              </span>
            </button>
          ))}
        </div>

        {/* Botón ejecutar / cancelar */}
        <div className="flex items-center gap-2 pt-2">
          {!isStreaming ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleExecute}
              className="flex-1"
            >
              {hasResult(selectedSkill) ? "Regenerar" : "Analizar con IA"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={cancel}
              className="flex-1"
            >
              <IconClose width={13} height={13} />
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <Divider />

      {/* ─── Estado del stream ─── */}
      {metadata && isStreaming && (
        <div className="shrink-0 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <span className="font-ui text-[10px] uppercase tracking-wider text-muted-light dark:text-muted-dark">
              {metadata.provider} · {metadata.estimated_tokens ?? "?"} tokens
            </span>
          </div>
        </div>
      )}

      {/* ─── Contenido ─── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Error */}
        {streamState === STREAM_STATES.ERROR && error && (
          <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/20">
            <p className="font-ui text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          </div>
        )}

        {/* Streaming o resultado */}
        {displayContent ? (
          <div className="space-y-3">
            {isStreaming && (
              <Badge tone="amber" className="mb-2">
                Generando…
              </Badge>
            )}
            <div className="prose-reading whitespace-pre-wrap text-reading-light dark:text-reading-dark">
              {displayContent}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-amber-600 align-middle" />
              )}
            </div>
            {!isStreaming && currentResult && (
              <div className="border-t border-seam-light pt-3 dark:border-seam-dark">
                <p className="font-ui text-[10px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
                  {currentResult.totalTokens} tokens · {currentResult.elapsedMs}ms · {currentResult.provider}
                </p>
              </div>
            )}
          </div>
        ) : (
          !error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark">
                <IconArrowDown width={20} height={20} />
              </div>
              <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
                Selecciona una tarea y pulsa «Analizar con IA»
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
