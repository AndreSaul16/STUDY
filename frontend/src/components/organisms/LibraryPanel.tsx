import { useState, useRef } from "react";
import { cn } from "@/utils/cn";
import { useLibraryStore } from "@/store/libraryStore";
import { useReaderStore } from "@/store/readerStore";
import { jwpubClient } from "@/services/jwpubClient";
import { jwpubDocumentToArticle } from "@/utils/htmlToBlocks";
import { Button } from "@/components/atoms/Button";
import { Badge } from "@/components/atoms/Badge";
import { Divider } from "@/components/atoms/Divider";
import { IconBook } from "@/components/atoms/Icons";
import { DailyTextCard } from "@/components/organisms/DailyTextCard";

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
  const setActiveDocument = useLibraryStore((s) => s.setActiveDocument);
  const activeDocumentIndex = useLibraryStore((s) => s.activeDocumentIndex);

  const setArticle = useReaderStore((s) => s.setArticle);

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

      // Cargar automáticamente la publicación
      loadPublication(result.publication, result.documents, result.toc);

      // Cargar el primer documento en el reader
      if (result.documents.length > 0) {
        const article = jwpubDocumentToArticle(result.documents[0]!);
        setArticle(article);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSelectDocument = (index: number) => {
    const doc = documents[index];
    if (!doc) return;
    setActiveDocument(index);
    const article = jwpubDocumentToArticle(doc);
    setArticle(article);
  };

  return (
    <div className={cn("flex h-full flex-col overflow-y-auto p-4", className)}>
      {/* Widget de inicio: texto del día (Examinemos las Escrituras) */}
      <DailyTextCard className="mb-4" />

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
