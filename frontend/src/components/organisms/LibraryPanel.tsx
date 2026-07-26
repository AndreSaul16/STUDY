import { useCallback, useEffect, useState, useRef } from "react";
import { cn } from "@/utils/cn";
import { useLibraryStore } from "@/store/libraryStore";
import { useUIStore } from "@/store/uiStore";
import { jwpubClient } from "@/services/jwpubClient";
import {
  deletePublication,
  listPublications,
  savePublication,
  type StoredPublication,
} from "@/services/libraryCache";
import { openJwpubDocument } from "@/services/readerActions";
import { Button } from "@/components/atoms/Button";
import { Badge } from "@/components/atoms/Badge";
import { Divider } from "@/components/atoms/Divider";
import { IconBook, IconTrash } from "@/components/atoms/Icons";

interface LibraryPanelProps {
  className?: string;
}

/**
 * LibraryPanel — UI para subir y seleccionar publicaciones .jwpub.
 *
 * Permite:
 *  - Subir un archivo .jwpub → backend lo desencripta y devuelve estructura
 *  - Listar publicaciones cargadas
 *  - Seleccionar un documento → carga en el reader
 */
export function LibraryPanel({ className }: LibraryPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    title: string;
    symbol: string;
    documentCount: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activePublication = useLibraryStore((s) => s.activePublication);
  const documents = useLibraryStore((s) => s.documents);
  const toc = useLibraryStore((s) => s.toc);
  const loadPublication = useLibraryStore((s) => s.loadPublication);
  const activeDocumentIndex = useLibraryStore((s) => s.activeDocumentIndex);
  const setMobileSheetOpen = useUIStore((s) => s.setMobileSheetOpen);

  /**
   * Todas las publicaciones guardadas en el navegador (IndexedDB).
   *
   * Se acumulan: cada .jwpub que subes se queda, sobrevive al refresco, al
   * cierre del navegador y a cualquier redespliegue del servidor. Antes solo
   * se restauraba la última y las demás quedaban invisibles aunque estuvieran
   * guardadas.
   */
  const [stored, setStored] = useState<StoredPublication[]>([]);

  const refreshStored = useCallback(async () => {
    try {
      setStored(await listPublications());
    } catch {
      // Sin biblioteca guardada: el estado vacío ya lo explica.
    }
  }, []);

  useEffect(() => {
    void refreshStored();
  }, [refreshStored]);

  // Al arrancar sin nada abierto, recuperar la última que se estuviera leyendo.
  useEffect(() => {
    if (activePublication || stored.length === 0) return;
    const latest = stored[0]!;
    loadPublication(latest.publication, latest.documents, latest.toc);
  }, [activePublication, stored, loadPublication]);

  const handleSelectPublication = async (symbol: string) => {
    const entry = stored.find((p) => p.symbol === symbol);
    if (!entry) return;
    loadPublication(entry.publication, entry.documents, entry.toc);
    if (entry.documents.length > 0) {
      await openJwpubDocument(0, symbol);
      setMobileSheetOpen(false);
    }
  };

  const handleRemovePublication = async (symbol: string) => {
    await deletePublication(symbol);
    await refreshStored();
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    setUploadResult(null);
    try {
      const result = await jwpubClient.upload(file);
      setUploadResult({
        title: result.publication.title,
        symbol: result.publication.symbol,
        documentCount: result.documentCount,
      });

      loadPublication(result.publication, result.documents, result.toc);
      // Guardarla en el navegador para que siga estando en la próxima visita.
      await savePublication(result.publication, result.documents, result.toc);
      await refreshStored();

      if (result.documents.length > 0) {
        await openJwpubDocument(0, result.publication.symbol);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el archivo");
    } finally {
      setBusy(false);
    }
  };

  const handleSelectDocument = (index: number) => {
    if (index < 0) return;
    void openJwpubDocument(index, activePublication?.symbol);
    setMobileSheetOpen(false);
  };

  return (
    <div className={cn("flex h-full flex-col overflow-y-auto p-4", className)}>
      <div className="mb-4">
        <h3 className="font-display text-xl text-reading-light dark:text-reading-dark">
          Biblioteca
        </h3>
        <p className="mt-1 font-ui text-xs text-muted-light dark:text-muted-dark">
          Sube un archivo .jwpub para estudiarlo.
        </p>
      </div>

      {/* ─── Upload ─── */}
      <section className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".jwpub"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full"
        >
          <IconBook width={14} height={14} />
          {busy ? "Procesando…" : "Subir .jwpub"}
        </Button>

        {uploadResult && (
          <div className="rounded-md bg-paper-100 p-3 dark:bg-ink-50">
            <div className="flex items-center gap-2">
              <Badge tone="amber">OK</Badge>
              <span className="font-ui text-xs text-reading-light dark:text-reading-dark">
                {uploadResult.title}
              </span>
            </div>
            <p className="mt-1 font-ui text-[10px] text-muted-light dark:text-muted-dark">
              {uploadResult.symbol} · {uploadResult.documentCount} documentos
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/20">
            <p className="font-ui text-xs text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}
      </section>

      {/* ─── Publicaciones guardadas en este navegador ─── */}
      {stored.length > 0 && (
        <>
          <Divider className="my-4" />
          <section className="space-y-2">
            <h4 className="font-ui text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Tus publicaciones · {stored.length}
            </h4>
            <ul className="space-y-1">
              {stored.map((pub) => {
                const activa = pub.symbol === activePublication?.symbol;
                return (
                  <li key={pub.symbol} className="group flex items-center gap-1">
                    <button
                      onClick={() => void handleSelectPublication(pub.symbol)}
                      className={cn(
                        "min-h-[44px] flex-1 rounded-md px-3 py-2 text-left transition-colors",
                        activa
                          ? "bg-amber-50 ring-1 ring-amber-600 dark:bg-amber-800/20"
                          : "hover:bg-paper-200 dark:hover:bg-ink-50",
                      )}
                    >
                      <span
                        className={cn(
                          "block truncate font-ui text-xs font-medium",
                          activa
                            ? "text-amber-800 dark:text-amber-300"
                            : "text-reading-light/80 dark:text-reading-dark/80",
                        )}
                      >
                        {pub.publication.title || pub.symbol}
                      </span>
                      <span className="mt-0.5 block font-ui text-[10px] text-muted-light dark:text-muted-dark">
                        {pub.symbol} · {pub.documents.length} documentos
                      </span>
                    </button>
                    <button
                      onClick={() => void handleRemovePublication(pub.symbol)}
                      aria-label={`Quitar ${pub.publication.title || pub.symbol}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-light transition-opacity hover:bg-red-50 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 dark:text-muted-dark dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <Divider className="my-4" />

      {/* ─── TOC / Document list ─── */}
      {activePublication && (
        <section className="space-y-2">
          <h4 className="font-ui text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
            {activePublication.title}
          </h4>

          {toc.length > 0 ? (
            <ul className="space-y-1">
              {toc
                .filter((item) => item.DocumentId >= 0)
                .map((item) => {
                  const docIndex = documents.findIndex(
                    (d) => d.DocumentId === item.DocumentId,
                  );
                  return (
                    <li key={item.Id}>
                      <button
                        onClick={() => handleSelectDocument(docIndex)}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left font-ui text-xs transition-colors",
                          docIndex === activeDocumentIndex
                            ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600 dark:bg-amber-800/20 dark:text-amber-300"
                            : "text-reading-light/70 hover:bg-paper-200 dark:text-reading-dark/70 dark:hover:bg-ink-50",
                        )}
                      >
                        {item.Title || `Documento ${item.DocumentId}`}
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc, index) => (
                <li key={doc.DocumentId}>
                  <button
                    onClick={() => handleSelectDocument(index)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left font-ui text-xs transition-colors",
                      index === activeDocumentIndex
                        ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600 dark:bg-amber-800/20 dark:text-amber-300"
                        : "text-reading-light/70 hover:bg-paper-200 dark:text-reading-dark/70 dark:hover:bg-ink-50",
                    )}
                  >
                    {doc.Title || `Documento ${doc.DocumentId}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ─── Empty state ─── */}
      {!activePublication && !busy && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark">
            <IconBook width={24} height={24} />
          </div>
          <p className="font-ui text-sm font-medium text-reading-light dark:text-reading-dark">
            Sin publicaciones
          </p>
          <p className="max-w-[240px] font-ui text-xs leading-relaxed text-muted-light dark:text-muted-dark">
            Sube un archivo .jwpub para comenzar a estudiar.
          </p>
        </div>
      )}
    </div>
  );
}
