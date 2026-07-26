import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import {
  searchLibrary,
  type LibrarySearchResult,
} from "@/services/referenceClient";
import { openWolDocument } from "@/services/readerActions";
import { useUIStore } from "@/store/uiStore";
import { IconSearch, IconClose } from "@/components/atoms/Icons";

interface SearchPanelProps {
  className?: string;
}

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 450;

/**
 * SearchPanel — búsqueda en la Biblioteca en Línea (Atalaya, libros, guía).
 *
 * Es la vía para llegar a cualquier publicación sin tener el .jwpub: se busca,
 * se pulsa un resultado y el artículo se abre en el lector con todo lo demás
 * ya funcionando encima (subrayado, notas, detección de citas).
 *
 * Búsqueda con retardo: cada pulsación es una petición a wol.jw.org, así que
 * se espera a que el usuario deje de escribir.
 */
export function SearchPanel({ className }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibrarySearchResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  const setMobileSheetOpen = useUIStore((s) => s.setMobileSheetOpen);
  // Descarta respuestas de búsquedas que ya no son la actual.
  const requestRef = useRef(0);

  const run = useCallback(async (term: string) => {
    const requestId = ++requestRef.current;
    setState("loading");
    try {
      const found = await searchLibrary(term, 12);
      if (requestRef.current !== requestId) return;
      setResults(found);
      setState("ready");
    } catch {
      if (requestRef.current !== requestId) return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      requestRef.current += 1; // invalida cualquier búsqueda en vuelo
      setResults([]);
      setState("idle");
      return;
    }

    const timer = setTimeout(() => void run(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  const open = (docId: number) => {
    void openWolDocument(docId);
    setMobileSheetOpen(false);
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="shrink-0 px-3 py-3">
        <label className="relative block">
          <span className="sr-only">Buscar en la Biblioteca en Línea</span>
          <IconSearch
            width={14}
            height={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-light dark:text-muted-dark"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en las publicaciones…"
            className={cn(
              "h-10 w-full rounded-lg bg-paper-100 pl-9 pr-9",
              "font-ui text-sm text-reading-light placeholder:text-muted-light/60",
              "ring-1 ring-seam-light focus:outline-none focus:ring-2 focus:ring-amber-500",
              "dark:bg-ink-50 dark:text-reading-dark dark:ring-seam-dark dark:placeholder:text-muted-dark/60",
            )}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Borrar búsqueda"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
            >
              <IconClose width={13} height={13} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {state === "idle" && (
          <p className="px-1 py-8 text-center font-ui text-xs leading-relaxed text-muted-light dark:text-muted-dark">
            Busca un tema, una frase o una cita.
            <br />
            Se consultan La Atalaya, los libros y la guía de actividades.
          </p>
        )}

        {state === "loading" && (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-paper-200 dark:bg-ink-50"
              />
            ))}
          </div>
        )}

        {state === "error" && (
          <p className="px-1 py-8 text-center font-ui text-xs text-muted-light dark:text-muted-dark">
            No se pudo completar la búsqueda. Inténtalo de nuevo.
          </p>
        )}

        {state === "ready" && results.length === 0 && (
          <p className="px-1 py-8 text-center font-ui text-xs text-muted-light dark:text-muted-dark">
            Sin resultados para «{query.trim()}».
          </p>
        )}

        {state === "ready" && results.length > 0 && (
          <ul className="space-y-1.5">
            {results.map((result) => (
              <li key={result.doc_id}>
                <button
                  onClick={() => open(result.doc_id)}
                  className={cn(
                    "w-full rounded-lg border border-transparent p-3 text-left",
                    "bg-paper-100 transition-colors dark:bg-ink-50",
                    "hover:border-amber-600/40 hover:bg-amber-50/50 dark:hover:bg-amber-800/10",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                  )}
                >
                  {result.citation && (
                    <span className="block font-ui text-[10px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
                      {result.citation}
                    </span>
                  )}
                  <span className="mt-1 block line-clamp-3 font-reading text-sm leading-relaxed text-reading-light/85 dark:text-reading-dark/85">
                    {result.snippet}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
