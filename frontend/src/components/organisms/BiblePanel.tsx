import { useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { fetchBooks, type BibleBook } from "@/services/bibleClient";
import { openBibleChapter } from "@/services/readerActions";
import { useReaderStore } from "@/store/readerStore";
import { useUIStore } from "@/store/uiStore";
import { IconArrowLeft, IconSearch } from "@/components/atoms/Icons";

interface BiblePanelProps {
  className?: string;
}

/**
 * BiblePanel — navegador de la Biblia: libro → capítulo.
 *
 * Dos pasos en vez de un desplegable gigante de 66 entradas: primero se filtra
 * y elige el libro, después se pulsa el capítulo en una rejilla. La rejilla se
 * pinta al instante porque el número de capítulos es una constante del canon
 * que sirve el backend sin tocar la red.
 */
export function BiblePanel({ className }: BiblePanelProps) {
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BibleBook | null>(null);

  const source = useReaderStore((s) => s.source);
  const setMobileSheetOpen = useUIStore((s) => s.setMobileSheetOpen);

  useEffect(() => {
    let cancelled = false;
    fetchBooks()
      .then((result) => {
        if (cancelled) return;
        setBooks(result);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return books;
    return books.filter((book) => normalize(book.name).includes(needle));
  }, [books, query]);

  const openChapter = (book: BibleBook, chapter: number) => {
    void openBibleChapter(book.name, chapter);
    // En móvil el lector está detrás del panel: al elegir capítulo hay que
    // devolver al usuario al texto, no dejarlo en el índice.
    setMobileSheetOpen(false);
  };

  if (state === "error") {
    return (
      <div className="p-6 text-center">
        <p className="font-ui text-sm text-reading-light dark:text-reading-dark">
          No se pudo cargar el índice bíblico
        </p>
        <p className="mt-1 font-ui text-xs text-muted-light dark:text-muted-dark">
          Comprueba tu conexión e inténtalo de nuevo.
        </p>
      </div>
    );
  }

  // ─── Paso 2: capítulos del libro elegido ───
  if (selected) {
    const currentChapter =
      source?.kind === "bible" && source.book === selected.name
        ? source.chapter
        : null;

    return (
      <div className={cn("flex h-full flex-col", className)}>
        <div className="flex shrink-0 items-center gap-2 px-3 py-3">
          <button
            onClick={() => setSelected(null)}
            aria-label="Volver a la lista de libros"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-md xl:h-9 xl:w-9 pointer-coarse:h-11 pointer-coarse:w-11",
              "text-muted-light hover:bg-paper-200 hover:text-reading-light",
              "dark:text-muted-dark dark:hover:bg-ink-50 dark:hover:text-reading-dark",
            )}
          >
            <IconArrowLeft width={16} height={16} />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-lg text-reading-light dark:text-reading-dark">
              {selected.name}
            </p>
            <p className="font-ui text-[10px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
              {selected.chapters} capítulos
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {/* Rejilla fluida: más columnas cuanto más ancho, celdas de 44px
              mínimo para que se puedan pulsar con el dedo. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
            {Array.from({ length: selected.chapters }, (_, i) => i + 1).map(
              (chapter) => (
                <button
                  key={chapter}
                  onClick={() => openChapter(selected, chapter)}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-md",
                    "font-ui text-sm tabular-nums transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                    chapter === currentChapter
                      ? "bg-amber-600 text-paper-50"
                      : "bg-paper-100 text-reading-light/80 hover:bg-amber-50 hover:text-amber-800 dark:bg-ink-50 dark:text-reading-dark/80 dark:hover:bg-amber-800/20 dark:hover:text-amber-300",
                  )}
                >
                  {chapter}
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Paso 1: elegir libro ───
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="shrink-0 px-3 py-3">
        <label className="relative block">
          <span className="sr-only">Buscar libro de la Biblia</span>
          <IconSearch
            width={14}
            height={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-light dark:text-muted-dark"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar libro…"
            className={cn(
              "h-10 w-full rounded-lg bg-paper-100 pl-9 pr-3",
              "font-ui text-sm text-reading-light placeholder:text-muted-light/60",
              "ring-1 ring-seam-light focus:outline-none focus:ring-2 focus:ring-amber-500",
              "dark:bg-ink-50 dark:text-reading-dark dark:ring-seam-dark dark:placeholder:text-muted-dark/60",
            )}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {state === "loading" && (
          <div className="space-y-1.5 px-3" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-md bg-paper-200 dark:bg-ink-50"
              />
            ))}
          </div>
        )}

        {state === "ready" && filtered.length === 0 && (
          <p className="px-4 py-6 text-center font-ui text-xs text-muted-light dark:text-muted-dark">
            Ningún libro coincide con «{query}».
          </p>
        )}

        {state === "ready" &&
          (["hebreas", "griegas"] as const).map((section) => {
            const inSection = filtered.filter((b) => b.section === section);
            if (inSection.length === 0) return null;

            return (
              <section key={section}>
                <h3
                  className={cn(
                    "sticky top-0 z-10 px-4 py-1.5",
                    "bg-paper-50/95 backdrop-blur dark:bg-ink-100/95",
                    "font-ui text-[10px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400",
                  )}
                >
                  Escrituras {section}
                </h3>
                <ul className="px-3 py-1">
                  {inSection.map((book) => (
                    <li key={book.number}>
                      <button
                        onClick={() => setSelected(book)}
                        className={cn(
                          "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-3 py-2",
                          "text-left font-ui text-sm transition-colors",
                          "text-reading-light/85 hover:bg-paper-200 hover:text-reading-light",
                          "dark:text-reading-dark/85 dark:hover:bg-ink-50 dark:hover:text-reading-dark",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                        )}
                      >
                        <span className="truncate">{book.name}</span>
                        <span className="shrink-0 font-ui text-[10px] tabular-nums text-muted-light dark:text-muted-dark">
                          {book.chapters}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </div>
  );
}

/** Minúsculas y sin acentos, para que "genesis" encuentre "Génesis". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
