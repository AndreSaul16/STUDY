import { useReferenceEngine } from "@/hooks/useReferenceEngine";
import { useReaderStore } from "@/store/readerStore";
import { useUIStore } from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { TabBar } from "@/components/molecules/TabBar";
import { HistoryNav } from "@/components/molecules/HistoryNav";
import { ReferenceCardExpanded } from "@/components/molecules/ReferenceCard";
import { ReferenceSkeleton } from "@/components/atoms/Skeleton";
import { AIPanel } from "@/components/organisms/AIPanel";
import { NotesPanel } from "@/components/organisms/NotesPanel";
import { InteropPanel } from "@/components/organisms/InteropPanel";
import { LibraryPanel } from "@/components/organisms/LibraryPanel";
import { ChatPanel } from "@/components/organisms/ChatPanel";
import {
  IconStar,
  IconStarFilled,
  IconTrash,
  IconNote,
  IconBookmark,
} from "@/components/atoms/Icons";
import { RESEARCH_TABS, LOAD_STATES, HIGHLIGHT_COLORS } from "@/types/domain";
import type { HighlightColor } from "@/types/domain";

interface ResearchPanelProps {
  className?: string;
}

const MARK_DOT: Record<HighlightColor, string> = {
  [HIGHLIGHT_COLORS.YELLOW]: "bg-mark-yellow",
  [HIGHLIGHT_COLORS.GREEN]: "bg-mark-green",
  [HIGHLIGHT_COLORS.BLUE]: "bg-mark-blue",
  [HIGHLIGHT_COLORS.PINK]: "bg-mark-pink",
  [HIGHLIGHT_COLORS.ORANGE]: "bg-mark-orange",
};

export function ResearchPanel({ className }: ResearchPanelProps) {
  const {
    activeReference,
    resolvedContent,
    loadState,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    toggleFavorite,
    isFavorite,
    favorites,
  } = useReferenceEngine();

  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const annotations = useReaderStore((s) => s.annotations);
  const removeAnnotation = useReaderStore((s) => s.removeAnnotation);
  const updateAnnotationColor = useReaderStore((s) => s.updateAnnotationColor);
  const setEditingNote = useReaderStore((s) => s.setEditingNote);

  return (
    <aside
      className={cn(
        "flex h-full flex-col",
        "bg-paper-50 dark:bg-ink-100",
        className,
      )}
    >
      {/* ─── Header ─── */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <IconBookmark
            width={16}
            height={16}
            className="text-amber-700 dark:text-amber-400"
          />
          <span className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-reading-light dark:text-reading-dark">
            Investigación
          </span>
        </div>
        <HistoryNav
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={goBack}
          onForward={goForward}
        />
      </header>

      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        counts={{
          [RESEARCH_TABS.ANNOTATIONS]: annotations.length,
          [RESEARCH_TABS.FAVORITES]: favorites.length,
        }}
      />

      {/* ─── Contenido ─── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === RESEARCH_TABS.LIBRARY && <LibraryPanel />}

        {activeTab === RESEARCH_TABS.REFERENCE && (
          <ReferenceTab
            loadState={loadState}
            activeReference={activeReference}
            resolvedContent={resolvedContent}
            isFavorite={
              activeReference ? isFavorite(activeReference.identifier) : false
            }
            onToggleFavorite={
              activeReference
                ? () => toggleFavorite(activeReference.identifier)
                : undefined
            }
          />
        )}

        {activeTab === RESEARCH_TABS.ANNOTATIONS && (
          <AnnotationsTab
            annotations={annotations}
            onRemove={removeAnnotation}
            onColorChange={updateAnnotationColor}
            onEditNote={setEditingNote}
          />
        )}

        {activeTab === RESEARCH_TABS.FAVORITES && (
          <FavoritesTab
            favorites={favorites}
            onToggle={toggleFavorite}
          />
        )}

        {activeTab === RESEARCH_TABS.AI && <AIPanel />}

        {activeTab === RESEARCH_TABS.CHAT && <ChatPanel />}

        {activeTab === RESEARCH_TABS.NOTES && <NotesPanel />}

        {activeTab === RESEARCH_TABS.INTEROP && <InteropPanel />}
      </div>
    </aside>
  );
}

// ─── Tab: Referencia activa ──────────────────────────────────────

function ReferenceTab({
  loadState,
  activeReference,
  resolvedContent,
  isFavorite,
  onToggleFavorite,
}: {
  loadState: typeof LOAD_STATES[keyof typeof LOAD_STATES];
  activeReference: ReturnType<typeof useReferenceEngine>["activeReference"];
  resolvedContent: ReturnType<typeof useReferenceEngine>["resolvedContent"];
  isFavorite: boolean;
  onToggleFavorite?: () => void;
}) {
  if (loadState === LOAD_STATES.LOADING) {
    return <ReferenceSkeleton />;
  }

  if (!activeReference || !resolvedContent) {
    return <EmptyState
      icon={<IconBookmark width={32} height={32} />}
      title="Sin referencia activa"
      hint="Pulsa una referencia en el texto para ver su contenido aquí."
    />;
  }

  return (
    <div className="p-5 animate-fade-rise">
      {onToggleFavorite && (
        <ReferenceCardExpanded
          reference={activeReference}
          resolved={resolvedContent}
          favorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </div>
  );
}

// ─── Tab: Anotaciones ────────────────────────────────────────────

function AnnotationsTab({
  annotations,
  onRemove,
  onColorChange,
  onEditNote,
}: {
  annotations: ReturnType<typeof useReaderStore.getState>["annotations"];
  onRemove: (id: string) => void;
  onColorChange: (id: string, color: HighlightColor) => void;
  onEditNote: (id: string | null) => void;
}) {
  if (annotations.length === 0) {
    return <EmptyState
      icon={<IconNote width={32} height={32} />}
      title="Sin anotaciones"
      hint="Selecciona texto en el panel de lectura para subrayar o añadir notas."
    />;
  }

  const sorted = [...annotations].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <ul className="divide-y divide-seam-light dark:divide-seam-dark">
      {sorted.map((ann) => (
        <li key={ann.id} className="p-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 h-3 w-3 shrink-0 rounded-sm",
                MARK_DOT[ann.color],
              )}
            />
            <div className="min-w-0 flex-1">
              <blockquote className="line-clamp-3 font-reading text-sm italic text-reading-light dark:text-reading-dark">
                {ann.selectedText}
              </blockquote>

              {ann.note && (
                <p className="mt-2 rounded-md bg-paper-100 px-3 py-2 font-ui text-xs text-muted-light dark:bg-ink-200 dark:text-muted-dark">
                  {ann.note}
                </p>
              )}

              {/* Acciones */}
              <div className="mt-3 flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  {Object.values(HIGHLIGHT_COLORS).map((c) => (
                    <button
                      key={c}
                      onClick={() => onColorChange(ann.id, c)}
                      aria-label={`Cambiar a ${c}`}
                      className={cn(
                        "h-4 w-4 rounded-full ring-1 ring-black/10 dark:ring-white/10",
                        "transition-transform hover:scale-125",
                        MARK_DOT[c],
                        ann.color === c && "ring-2 ring-amber-600",
                      )}
                    />
                  ))}
                </div>

                <div className="mx-1 h-4 w-px bg-seam-light dark:bg-seam-dark" />

                <button
                  onClick={() => onEditNote(ann.id)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 font-ui text-[11px] text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-50 dark:hover:text-reading-dark"
                >
                  <IconNote width={12} height={12} />
                  {ann.note ? "Editar" : "Nota"}
                </button>

                <button
                  onClick={() => onRemove(ann.id)}
                  aria-label="Eliminar anotación"
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-light hover:bg-red-50 hover:text-red-600 dark:text-muted-dark dark:hover:bg-red-900/20 dark:hover:text-red-400"
                >
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Tab: Favoritos ──────────────────────────────────────────────

function FavoritesTab({
  favorites,
  onToggle,
}: {
  favorites: string[];
  onToggle: (identifier: string) => void;
}) {
  if (favorites.length === 0) {
    return <EmptyState
      icon={<IconStar width={32} height={32} />}
      title="Sin favoritos"
      hint="Marca referencias con la estrella para guardarlas aquí."
    />;
  }

  return (
    <ul className="divide-y divide-seam-light dark:divide-seam-dark">
      {favorites.map((identifier) => (
        <li key={identifier} className="group flex items-center gap-3 p-4">
          <IconStarFilled
            width={14}
            height={14}
            className="shrink-0 text-amber-500"
          />
          <span className="flex-1 truncate font-ui text-sm text-reading-light dark:text-reading-dark">
            {identifier}
          </span>
          <button
            onClick={() => onToggle(identifier)}
            aria-label="Quitar de favoritos"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-light opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:text-muted-dark dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            <IconTrash width={13} height={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Empty State ─────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark">
        {icon}
      </div>
      <p className="font-ui text-sm font-medium text-reading-light dark:text-reading-dark">
        {title}
      </p>
      <p className="max-w-[240px] font-ui text-xs leading-relaxed text-muted-light dark:text-muted-dark">
        {hint}
      </p>
    </div>
  );
}
