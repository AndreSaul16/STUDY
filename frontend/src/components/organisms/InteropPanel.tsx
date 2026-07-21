import { useState, useRef } from "react";
import { cn } from "@/utils/cn";
import { jwlibraryClient } from "@/services/jwlibraryClient";
import type { ImportResultDTO } from "@/services/jwlibraryClient";
import { Button } from "@/components/atoms/Button";
import { Badge } from "@/components/atoms/Badge";
import { Divider } from "@/components/atoms/Divider";
import { IconBook, IconBookmark, IconNote, IconStar } from "@/components/atoms/Icons";

interface InteropPanelProps {
  className?: string;
}

/**
 * InteropPanel — UI para import/export de archivos .jwlibrary.
 *
 * Permite:
 *  - Importar un .jwlibrary para analizar su contenido.
 *  - Exportar notas/marcas a un .jwlibrary existente (inyección).
 *  - Crear un .jwlibrary nuevo desde cero.
 */
export function InteropPanel({ className }: InteropPanelProps) {
  const [importResult, setImportResult] = useState<ImportResultDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const exportFileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const result = await jwlibraryClient.importFile(file);
      setImportResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      // TODO (B10): Leer marks/notes/tags reales de SQLite local.
      // Por ahora exportamos un request vacío — el backend genera un
      // .jwlibrary válido pero sin datos inyectados. Útil para validar
      // el formato, pero no es un export real.
      const request = {
        marks: [],
        tags: [],
        note_tag_links: [],
      };
      const blob = await jwlibraryClient.exportToFile(file, request);
      jwlibraryClient.downloadBlob(blob, "study-export.jwlibrary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const handleExportNew = async () => {
    setBusy(true);
    setError(null);
    try {
      // TODO (B10): Leer marks/notes/tags reales de SQLite local.
      // Por ahora generamos un .jwlibrary vacío válido.
      const request = {
        marks: [],
        tags: [],
        note_tag_links: [],
      };
      const blob = await jwlibraryClient.exportNew(request);
      jwlibraryClient.downloadBlob(blob, "study-new.jwlibrary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex h-full flex-col overflow-y-auto p-4", className)}>
      <div className="mb-4">
        <h3 className="font-display text-xl text-reading-light dark:text-reading-dark">
          Interoperabilidad .jwlibrary
        </h3>
        <p className="mt-1 font-ui text-xs text-muted-light dark:text-muted-dark">
          Importa y exporta copias de seguridad compatibles con la app oficial.
        </p>
      </div>

      {/* ─── Import ─── */}
      <section className="space-y-3">
        <h4 className="font-ui text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
          Importar
        </h4>
        <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
          Analiza un archivo .jwlibrary sin modificarlo.
        </p>
        <input
          ref={importFileRef}
          type="file"
          accept=".jwlibrary"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => importFileRef.current?.click()}
          disabled={busy}
        >
          <IconBook width={14} height={14} />
          {busy ? "Analizando…" : "Seleccionar .jwlibrary"}
        </Button>

        {importResult && (
          <div className="rounded-md bg-paper-100 p-3 dark:bg-ink-50">
            <div className="flex items-center gap-2">
              {importResult.success ? (
                <Badge tone="amber">OK</Badge>
              ) : (
                <Badge tone="muted">Con errores</Badge>
              )}
              <span className="font-ui text-xs text-reading-light dark:text-reading-dark">
                Análisis completo
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 font-ui text-xs">
              <Stat icon={<IconHighlight />} label="Marcas" value={importResult.user_marks_count} />
              <Stat icon={<IconNote width={12} height={12} />} label="Notas" value={importResult.notes_count} />
              <Stat icon={<IconStar width={12} height={12} />} label="Etiquetas" value={importResult.tags_count} />
              <Stat icon={<IconBookmark width={12} height={12} />} label="Marcadores" value={importResult.bookmarks_count} />
            </dl>
            {importResult.documents.length > 0 && (
              <p className="mt-2 font-ui text-[10px] text-muted-light dark:text-muted-dark">
                Documentos: {importResult.documents.join(", ")}
              </p>
            )}
            {importResult.errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {importResult.errors.map((err, i) => (
                  <li key={i} className="font-ui text-[10px] text-red-600 dark:text-red-400">
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <Divider className="my-4" />

      {/* ─── Export ─── */}
      <section className="space-y-3">
        <h4 className="font-ui text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
          Exportar
        </h4>
        <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
          Inyecta tus notas y marcas en un .jwlibrary existente.
        </p>
        <div className="rounded-md bg-amber-50 px-3 py-2 dark:bg-amber-900/20">
          <p className="font-ui text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
            ⚠ Demo: el export genera un .jwlibrary válido pero sin datos inyectados.
            La lectura de SQLite local para poblar el export es una feature pendiente.
          </p>
        </div>
        <input
          ref={exportFileRef}
          type="file"
          accept=".jwlibrary"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleExport(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportFileRef.current?.click()}
          disabled={busy}
        >
          <IconBook width={14} height={14} />
          Inyectar en .jwlibrary
        </Button>

        <Divider variant="dotted" className="my-2" />

        <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
          O crea un backup nuevo desde cero.
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={handleExportNew}
          disabled={busy}
        >
          Crear .jwlibrary nuevo
        </Button>
      </section>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 dark:bg-red-900/20">
          <p className="font-ui text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-light dark:text-muted-dark">{icon}</span>
      <span className="text-muted-light dark:text-muted-dark">{label}:</span>
      <span className="font-medium tabular-nums text-reading-light dark:text-reading-dark">{value}</span>
    </div>
  );
}

function IconHighlight() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9 11l-4 4v3h3l4-4M9 11l5-5 4 4-5 5M9 11l4 4" />
    </svg>
  );
}
