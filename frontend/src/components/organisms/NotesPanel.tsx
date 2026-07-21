import { useState, useEffect } from "react";
import { cn } from "@/utils/cn";
import { useDatabaseReady } from "@/hooks/useDatabase";
import { useVirtualList } from "@/hooks/useVirtualList";
import { notesRepository } from "@/db/repositories/notesRepository";
import { searchRepository } from "@/db/repositories/searchRepository";
import type { NoteRow } from "@/db/repositories/notesRepository";
import type { SearchResult as SearchHit } from "@/db/repositories/searchRepository";
import { Badge } from "@/components/atoms/Badge";
import { Divider } from "@/components/atoms/Divider";
import { IconSearch, IconNote, IconClose } from "@/components/atoms/Icons";

interface NotesPanelProps {
  className?: string;
}

const ITEM_HEIGHT = 88;

/**
 * NotesPanel — panel de notas con búsqueda semántica FTS5 y virtualización.
 *
 * Cuando hay query: muestra resultados de búsqueda con highlight.
 * Cuando no hay query: lista todas las notas con virtualización
 * (para rendimiento con miles de notas).
 */
export function NotesPanel({ className }: NotesPanelProps) {
  const ready = useDatabaseReady();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);

  // Cargar notas cuando la DB está lista
  useEffect(() => {
    if (!ready) return;
    const all = notesRepository.getAll(500);
    setNotes(all);
  }, [ready]);

  // Búsqueda con debounce
  useEffect(() => {
    if (!ready || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      const results = searchRepository.search(query, 50);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, ready]);

  const isSearching = query.trim().length > 0;
  const itemCount = isSearching ? searchResults.length : notes.length;

  const { virtualItems, totalHeight, containerRef } = useVirtualList({
    itemCount,
    estimateSize: ITEM_HEIGHT,
    // containerHeight se mide automáticamente via ResizeObserver
  });

  if (!ready) {
    return (
      <div className={cn("flex h-full items-center justify-center p-8", className)}>
        <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
          Inicializando base de datos…
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* ─── Búsqueda ─── */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-full bg-paper-50 px-3 py-1.5 ring-1 ring-seam-light dark:bg-ink-50 dark:ring-seam-dark">
          <IconSearch width={14} height={14} className="shrink-0 text-muted-light dark:text-muted-dark" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en notas…"
            className="min-w-0 flex-1 bg-transparent font-ui text-sm text-reading-light placeholder:text-muted-light/60 focus:outline-none dark:text-reading-dark dark:placeholder:text-muted-dark/60"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
            >
              <IconClose width={13} height={13} />
            </button>
          )}
        </div>
        {isSearching && (
          <p className="mt-1.5 font-ui text-[10px] text-muted-light dark:text-muted-dark">
            {searchResults.length} resultados · {searchRepository.isUsingFTS5() ? "bm25 ranking" : "ranking por coincidencia"}
          </p>
        )}
      </div>

      <Divider />

      {/* ─── Lista virtualizada ─── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {itemCount === 0 ? (
          <EmptyNotes isSearching={isSearching} />
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            {virtualItems.map(({ index, offsetTop }) => {
              if (isSearching) {
                const hit = searchResults[index];
                if (!hit) return null;
                return (
                  <div
                    key={hit.note_id}
                    style={{ position: "absolute", top: offsetTop, left: 0, right: 0, height: ITEM_HEIGHT }}
                    className="border-b border-seam-light px-4 py-2 dark:border-seam-dark"
                  >
                    <SearchResultItem hit={hit} />
                  </div>
                );
              }
              const note = notes[index];
              if (!note) return null;
              return (
                <div
                  key={note.note_id}
                  style={{ position: "absolute", top: offsetTop, left: 0, right: 0, height: ITEM_HEIGHT }}
                  className="border-b border-seam-light px-4 py-2 dark:border-seam-dark"
                >
                  <NoteItem note={note} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Footer stats ─── */}
      <div className="shrink-0 border-t border-seam-light px-4 py-2 dark:border-seam-dark">
        <p className="font-ui text-[10px] uppercase tracking-wider text-muted-light dark:text-muted-dark">
          {notesRepository.count()} notas · {searchRepository.isUsingFTS5() ? "SQLite FTS5" : "SQLite (búsqueda LIKE)"}
        </p>
      </div>
    </div>
  );
}

function NoteItem({ note }: { note: NoteRow }) {
  return (
    <div className="flex h-full flex-col justify-center">
      {note.title && (
        <p className="truncate font-ui text-xs font-medium text-reading-light dark:text-reading-dark">
          {note.title}
        </p>
      )}
      <p className={cn("line-clamp-2 font-reading text-sm italic", !note.title && "mt-0")}>
        {note.content || "(sin contenido)"}
      </p>
      <p className="mt-0.5 font-ui text-[10px] text-muted-light dark:text-muted-dark">
        Doc #{note.document_id} · {new Date(note.last_modified * 1000).toLocaleDateString("es")}
      </p>
    </div>
  );
}

function SearchResultItem({ hit }: { hit: SearchHit }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-center gap-2">
        <Badge tone="amber">{hit.rank.toFixed(2)}</Badge>
        <p className="truncate font-ui text-xs font-medium text-reading-light dark:text-reading-dark">
          {hit.title || "(sin título)"}
        </p>
      </div>
      <p
        className="mt-0.5 line-clamp-2 font-reading text-sm italic text-muted-light dark:text-muted-dark"
        dangerouslySetInnerHTML={{ __html: hit.snippet }}
      />
    </div>
  );
}

function EmptyNotes({ isSearching }: { isSearching: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark">
        {isSearching ? <IconSearch width={20} height={20} /> : <IconNote width={20} height={20} />}
      </div>
      <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
        {isSearching
          ? "Sin resultados para esta búsqueda"
          : "Aún no hay notas. Selecciona texto en el panel de lectura para crear una."}
      </p>
    </div>
  );
}
