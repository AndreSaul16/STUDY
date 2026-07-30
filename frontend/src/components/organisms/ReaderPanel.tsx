import { useRef, useState, useCallback, useEffect } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useUIStore } from "@/store/uiStore";
import { useDbStore } from "@/store/dbStore";
import { useDatabaseReady } from "@/hooks/useDatabase";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useChapterSearch } from "@/hooks/useChapterSearch";
import { stepChapter } from "@/services/readerActions";
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
  IconHome,
  IconChat,
  IconArrowLeft,
  IconArrowRight,
} from "@/components/atoms/Icons";
import { Tooltip } from "@/components/atoms/Tooltip";
import { Divider } from "@/components/atoms/Divider";
import { SearchBar } from "@/components/molecules/SearchBar";
import { ContextMenu } from "@/components/molecules/ContextMenu";
import { NoteEditor } from "@/components/molecules/NoteEditor";
import { BlockRenderer } from "@/components/organisms/BlockRenderer";
import { HomeScreen } from "@/components/organisms/HomeScreen";
import { APP_VIEWS } from "@/types/domain";
import type { HighlightColor } from "@/types/domain";

interface ReaderPanelProps {
  className?: string;
}

export function ReaderPanel({ className }: ReaderPanelProps) {
  const article = useReaderStore((s) => s.article);
  const source = useReaderStore((s) => s.source);
  const loading = useReaderStore((s) => s.loading);
  const annotations = useReaderStore((s) => s.annotations);
  const addAnnotation = useReaderStore((s) => s.addAnnotation);
  const setAnnotations = useReaderStore((s) => s.setAnnotations);
  const updateAnnotationNote = useReaderStore((s) => s.updateAnnotationNote);
  const editingNoteId = useReaderStore((s) => s.editingNoteId);
  const setEditingNote = useReaderStore((s) => s.setEditingNote);
  const closeArticle = useReaderStore((s) => s.closeArticle);
  const setProgress = useReaderStore((s) => s.setProgress);

  const dbReady = useDatabaseReady();
  const bumpDbRevision = useDbStore((s) => s.bumpDbRevision);

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const searchOpen = useUIStore((s) => s.searchOpen);
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);
  const setView = useUIStore((s) => s.setView);

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
    blocks: article?.blocks ?? [],
    containerRef: scrollRef,
  });

  const documentId = article?.documentId ?? null;
  const publicationKey = article?.publicationSymbol ?? "legacy";
  const isBible = source?.kind === "bible";

  // Hidratar anotaciones desde SQLite cuando la DB está lista y cambia el documento.
  useEffect(() => {
    if (!dbReady || documentId === null) return;
    try {
      setAnnotations(loadAnnotations(documentId, publicationKey));
    } catch (e) {
      console.warn("[reader] no se pudieron cargar anotaciones:", e);
    }
  }, [dbReady, documentId, publicationKey, setAnnotations]);

  // Guardar el progreso de lectura (con throttle por rAF) para poder retomar.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !article) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scrollable = node.scrollHeight - node.clientHeight;
        setProgress(scrollable > 0 ? node.scrollTop / scrollable : 0);
      });
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [article, setProgress]);

  // Volver arriba al cambiar de documento: si no, se abre un capítulo nuevo
  // con el scroll heredado del anterior.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [documentId]);

  // ← / → para cambiar de capítulo mientras se lee la Biblia.
  useEffect(() => {
    if (!isBible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;

      if (e.key === "ArrowLeft") stepChapter(-1);
      if (e.key === "ArrowRight") stepChapter(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isBible]);

  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!selection || !article) return;
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
          persistedId = persistAnnotation(
            payload,
            article.documentId,
            publicationKey,
            article.blocks.find((block) => block.blockId === payload.blockId)?.content,
          );
          bumpDbRevision();
        } catch (e) {
          console.warn("[reader] fallo al persistir la marca, se guarda en memoria:", e);
        }
      }
      addAnnotation(payload, persistedId);
      clearSelection();
    },
    [selection, addAnnotation, clearSelection, dbReady, article, publicationKey, bumpDbRevision],
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
      if (!pendingNoteSelection || !article) return;
      const payload = {
        ...pendingNoteSelection,
        color: "yellow" as HighlightColor,
        note,
      };
      let persistedId: string | undefined;
      if (dbReady) {
        try {
          persistedId = persistAnnotation(
            payload,
            article.documentId,
            publicationKey,
            article.blocks.find((block) => block.blockId === payload.blockId)?.content,
          );
          bumpDbRevision();
        } catch (e) {
          console.warn("[reader] fallo al persistir la nota, se guarda en memoria:", e);
        }
      }
      addAnnotation(payload, persistedId);
      setPendingNoteSelection(null);
    },
    [pendingNoteSelection, addAnnotation, dbReady, article, publicationKey, bumpDbRevision],
  );

  const editingAnnotation = annotations.find((a) => a.id === editingNoteId);

  return (
    <section
      className={cn(
        "flex h-full min-w-0 flex-col",
        "bg-paper-100 dark:bg-ink-200",
        className,
      )}
    >
      {/* ─── Topbar ─── */}
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-2",
          "px-3 py-2 sm:px-6 sm:py-3 lg:px-8",
          // Apaisado: con 390px de alto, una cabecera de 68px es el 17% de la
          // pantalla antes de empezar a leer.
          "short:py-1 short:sm:py-1",
          "border-b border-seam-light dark:border-seam-dark",
          // Respeta el notch en móviles con pantalla completa.
          "pt-[max(0.5rem,env(safe-area-inset-top))]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {/* Volver al chat desde la lectura. En escritorio no hay barra
              inferior, así que sin esto la vista de lectura sería un callejón
              sin salida cuando hay un artículo abierto. */}
          <Tooltip content="Ir al chat" side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Ir al chat"
              onClick={() => setView(APP_VIEWS.CHAT)}
            >
              <IconChat width={16} height={16} />
            </Button>
          </Tooltip>
          {article && (
            <Tooltip content="Inicio" side="bottom">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Volver al inicio"
                onClick={closeArticle}
              >
                <IconHome width={16} height={16} />
              </Button>
            </Tooltip>
          )}
          <div className="min-w-0">
            <span className="block truncate font-display text-base text-amber-800 dark:text-amber-400 sm:text-lg">
              {article ? article.title : "Study"}
            </span>
            {!article && (
              <span className="hidden font-ui text-[10px] uppercase tracking-[0.2em] text-muted-light dark:text-muted-dark sm:block">
                Escritorio de Lectura
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {searchOpen && article && (
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
              className="w-40 sm:w-64"
            />
          )}
          {article && (
            <Tooltip content="Buscar en el texto (⌘K)" side="bottom">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Buscar en el texto"
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <IconSearch width={16} height={16} />
              </Button>
            </Tooltip>
          )}
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
          "flex-1 overflow-y-auto overflow-x-hidden",
          // Paddings fluidos: cómodos en móvil, generosos en pantalla grande.
          "px-4 py-6 sm:px-10 sm:py-10 lg:px-16 lg:py-14",
          "short:py-3 short:sm:py-3 short:lg:py-3",
          // Hueco para la barra de navegación inferior en móvil.
          "pb-24 md:pb-14",
        )}
      >
        {loading && <ReaderSkeleton />}

        {!loading && !article && <HomeScreen />}

        {!loading && article && (
          <article className="mx-auto max-w-[68ch]">
            <div className="mb-8 animate-fade-rise sm:mb-12">
              <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
                {article.publicationSymbol && article.publicationSymbol !== "legacy"
                  ? article.publicationSymbol
                  : "Lectura"}
              </p>
              <Divider variant="amber" className="mt-3 w-16" />
            </div>

            <div className="space-y-5 sm:space-y-6">
              {article.blocks.map((block, i) => (
                <div
                  key={block.blockId}
                  className="animate-fade-rise"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
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

            {/* Navegación de capítulos — sólo tiene sentido en la Biblia. */}
            {isBible && source.kind === "bible" && (
              <nav className="mt-12 flex items-center justify-between gap-3 border-t border-seam-light pt-6 dark:border-seam-dark">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => stepChapter(-1)}
                  disabled={source.chapter <= 1}
                  className="min-h-[44px]"
                >
                  <IconArrowLeft width={14} height={14} />
                  Anterior
                </Button>
                <span className="font-ui text-[10px] uppercase tracking-[0.2em] text-muted-light dark:text-muted-dark">
                  {source.book} {source.chapter}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => stepChapter(1)}
                  className="min-h-[44px]"
                >
                  Siguiente
                  <IconArrowRight width={14} height={14} />
                </Button>
              </nav>
            )}

            {!isBible && (
              <footer className="mt-14 border-t border-seam-light pt-6 dark:border-seam-dark">
                <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-muted-light dark:text-muted-dark">
                  Fin del documento · {article.blocks.length} bloques
                </p>
              </footer>
            )}
          </article>
        )}

        {/* Editor de nota flotante */}
        {pendingNoteSelection && (
          <div className="sticky bottom-6 z-50 mx-auto max-w-[68ch] animate-fade-rise">
            <NoteEditor
              initialNote={null}
              selectedText={pendingNoteSelection.selectedText}
              onSave={handleSaveNote}
              onCancel={() => setPendingNoteSelection(null)}
            />
          </div>
        )}

        {/* Editor de nota existente */}
        {editingAnnotation && editingNoteId && article && (
          <div className="sticky bottom-6 z-50 mx-auto max-w-[68ch] animate-fade-rise">
            <NoteEditor
              initialNote={editingAnnotation.note}
              selectedText={editingAnnotation.selectedText}
              onSave={(note) => {
                if (dbReady) {
                  try {
                    persistNoteUpdate(
                      editingAnnotation.id,
                      note,
                      article.documentId,
                      editingAnnotation.blockId,
                      publicationKey,
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

// ─── Esqueleto de carga ──────────────────────────────────────────

function ReaderSkeleton() {
  return (
    <div className="mx-auto max-w-[68ch] space-y-4" aria-label="Cargando lectura">
      <div className="h-10 w-2/3 animate-pulse rounded bg-paper-200 dark:bg-ink-50" />
      <div className="h-px w-16 bg-amber-600/40" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded bg-paper-200 dark:bg-ink-50"
            style={{ width: `${70 + ((i * 13) % 30)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
