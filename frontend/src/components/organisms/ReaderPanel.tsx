import { useRef, useState, useCallback, useEffect } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useUIStore } from "@/store/uiStore";
import { useDbStore } from "@/store/dbStore";
import { useDatabaseReady } from "@/hooks/useDatabase";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useChapterSearch } from "@/hooks/useChapterSearch";
import {
  persistAnnotation,
  loadAnnotations,
  updateAnnotationNote as persistNoteUpdate,
} from "@/services/annotationsService";
import { cn } from "@/utils/cn";
import { Button } from "@/components/atoms/Button";
import {
  IconSearch,
  IconSun,
  IconMoon,
} from "@/components/atoms/Icons";
import { Tooltip } from "@/components/atoms/Tooltip";
import { Divider } from "@/components/atoms/Divider";
import { SearchBar } from "@/components/molecules/SearchBar";
import { ContextMenu } from "@/components/molecules/ContextMenu";
import { NoteEditor } from "@/components/molecules/NoteEditor";
import { BlockRenderer } from "@/components/organisms/BlockRenderer";
import type { HighlightColor } from "@/types/domain";

interface ReaderPanelProps {
  className?: string;
}

export function ReaderPanel({ className }: ReaderPanelProps) {
  const article = useReaderStore((s) => s.article);
  const annotations = useReaderStore((s) => s.annotations);
  const addAnnotation = useReaderStore((s) => s.addAnnotation);
  const setAnnotations = useReaderStore((s) => s.setAnnotations);
  const updateAnnotationNote = useReaderStore((s) => s.updateAnnotationNote);
  const editingNoteId = useReaderStore((s) => s.editingNoteId);
  const setEditingNote = useReaderStore((s) => s.setEditingNote);

  const dbReady = useDatabaseReady();
  const bumpDbRevision = useDbStore((s) => s.bumpDbRevision);
  const documentId = article.documentId;

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const searchOpen = useUIStore((s) => s.searchOpen);
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);

  const scrollRef = useRef<HTMLElement>(null);
  const [pendingNoteSelection, setPendingNoteSelection] =
    useState<{
      blockId: number;
      startOffset: number;
      endOffset: number;
      selectedText: string;
    } | null>(null);

  const { selection, clearSelection } = useTextSelection({
    containerSelector: "[data-reader-content]",
  });

  const search = useChapterSearch({
    blocks: article.blocks,
    containerRef: scrollRef,
  });

  // Hidratar anotaciones desde SQLite cuando la DB está lista y cambia el documento.
  useEffect(() => {
    if (!dbReady) return;
    try {
      setAnnotations(loadAnnotations(documentId));
    } catch (e) {
      console.warn("[reader] no se pudieron cargar anotaciones:", e);
    }
  }, [dbReady, documentId, setAnnotations]);

  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!selection) return;
      const payload = {
        blockId: selection.blockId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        selectedText: selection.selectedText,
        color,
        note: null,
      };
      let persistedId: string | undefined;
      if (dbReady) {
        try {
          persistedId = persistAnnotation(payload, documentId);
          bumpDbRevision();
        } catch (e) {
          console.warn("[reader] fallo al persistir la marca, se guarda en memoria:", e);
        }
      }
      addAnnotation(payload, persistedId);
      clearSelection();
    },
    [selection, addAnnotation, clearSelection, dbReady, documentId, bumpDbRevision],
  );

  const handleAddNote = useCallback(() => {
    if (!selection) return;
    setPendingNoteSelection({
      blockId: selection.blockId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      selectedText: selection.selectedText,
    });
    clearSelection();
  }, [selection, clearSelection]);

  const handleSaveNote = useCallback(
    (note: string | null) => {
      if (!pendingNoteSelection) return;
      const payload = {
        ...pendingNoteSelection,
        color: "yellow" as HighlightColor,
        note,
      };
      let persistedId: string | undefined;
      if (dbReady) {
        try {
          persistedId = persistAnnotation(payload, documentId);
          bumpDbRevision();
        } catch (e) {
          console.warn("[reader] fallo al persistir la nota, se guarda en memoria:", e);
        }
      }
      addAnnotation(payload, persistedId);
      setPendingNoteSelection(null);
    },
    [pendingNoteSelection, addAnnotation, dbReady, documentId, bumpDbRevision],
  );

  // Anotación en edición de nota
  const editingAnnotation = annotations.find((a) => a.id === editingNoteId);

  return (
    <section
      className={cn(
        "flex h-full flex-col",
        "bg-paper-100 dark:bg-ink-200",
        className,
      )}
    >
      {/* ─── Topbar ─── */}
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3",
          "px-5 py-3 sm:px-8",
          "border-b border-seam-light dark:border-seam-dark",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-lg text-amber-800 dark:text-amber-400">
            Study
          </span>
          <span className="hidden font-ui text-[10px] uppercase tracking-[0.2em] text-muted-light dark:text-muted-dark sm:inline">
            · Escritorio de Lectura
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {searchOpen && (
            <SearchBar
              query={search.query}
              onChange={search.setQuery}
              onClear={() => {
                search.clear();
                setSearchOpen(false);
              }}
              onNext={search.goToNext}
              onPrev={search.goToPrev}
              label={search.currentLabel}
              className="w-64"
            />
          )}
          <Tooltip content="Buscar (⌘K)" side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Buscar"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <IconSearch width={16} height={16} />
            </Button>
          </Tooltip>
          <Tooltip content={theme === "light" ? "Modo oscuro" : "Modo claro"} side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Cambiar tema"
              onClick={toggleTheme}
            >
              {theme === "light" ? (
                <IconMoon width={16} height={16} />
              ) : (
                <IconSun width={16} height={16} />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>

      {/* ─── Contenido scrollable ─── */}
      <main
        ref={scrollRef}
        data-reader-content
        className={cn(
          "flex-1 overflow-y-auto",
          "px-5 py-8 sm:px-12 sm:py-12 lg:px-20 lg:py-16",
        )}
      >
        <article className="mx-auto max-w-[68ch]">
          {/* Metadatos editoriales */}
          <div className="mb-12 animate-fade-rise">
            <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
              Estudio Bíblico · Documento #{article.documentId}
            </p>
            <Divider variant="amber" className="mt-3 w-16" />
          </div>

          {/* Bloques */}
          <div className="space-y-6">
            {article.blocks.map((block, i) => (
              <div
                key={block.blockId}
                className="animate-fade-rise"
                style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }}
              >
                <BlockRenderer
                  block={block}
                  annotations={annotations.filter(
                    (a) => a.blockId === block.blockId,
                  )}
                />
              </div>
            ))}
          </div>

          {/* Colofón */}
          <footer className="mt-16 border-t border-seam-light pt-6 dark:border-seam-dark">
            <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-muted-light dark:text-muted-dark">
              Fin del documento · {article.blocks.length} bloques
            </p>
          </footer>
        </article>

        {/* Editor de nota flotante */}
        {pendingNoteSelection && (
          <div
            className={cn(
              "sticky bottom-6 z-50 mx-auto max-w-[68ch]",
              "animate-fade-rise",
            )}
          >
            <NoteEditor
              initialNote={null}
              selectedText={pendingNoteSelection.selectedText}
              onSave={handleSaveNote}
              onCancel={() => setPendingNoteSelection(null)}
            />
          </div>
        )}

        {/* Editor de nota existente */}
        {editingAnnotation && editingNoteId && (
          <div
            className={cn(
              "sticky bottom-6 z-50 mx-auto max-w-[68ch]",
              "animate-fade-rise",
            )}
          >
            <NoteEditor
              initialNote={editingAnnotation.note}
              selectedText={editingAnnotation.selectedText}
              onSave={(note) => {
                if (dbReady) {
                  try {
                    persistNoteUpdate(
                      editingAnnotation.id,
                      note,
                      documentId,
                      editingAnnotation.blockId,
                    );
                    bumpDbRevision();
                  } catch (e) {
                    console.warn("[reader] fallo al actualizar la nota:", e);
                  }
                }
                updateAnnotationNote(editingAnnotation.id, note);
                setEditingNote(null);
              }}
              onCancel={() => setEditingNote(null)}
            />
          </div>
        )}
      </main>

      {/* ─── Menú contextual sobre selección ─── */}
      {selection && (
        <ContextMenu
          selection={selection}
          onClose={clearSelection}
          onHighlight={handleHighlight}
          onAddNote={handleAddNote}
        />
      )}
    </section>
  );
}
