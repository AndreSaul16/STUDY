import { useState, useRef } from "react";
import { cn } from "@/utils/cn";
import { jwlibraryClient } from "@/services/jwlibraryClient";
import type { ExportRequestDTO, ImportResultDTO } from "@/services/jwlibraryClient";
import { marksRepository } from "@/db/repositories/marksRepository";
import { notesRepository } from "@/db/repositories/notesRepository";
import { tagsRepository } from "@/db/repositories/tagsRepository";
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
 */
export function InteropPanel({ className }: InteropPanelProps) {
  const [importResult, setImportResult] = useState<ImportResultDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const exportFileRef = useRef<HTMLInputElement>(null);

  /** Color local → ColorIndex de JW Library (1-9). */
  const COLOR_INDEX: Record<string, number> = {
    yellow: 1,
    blue: 2,
    green: 3,
    orange: 4,
    pink: 7,
  };

  /**
   * Reconstruye la localización de JW Library a partir de la marca local.
   *
   * `publication_key` y `document_id` los fija `toArticle.ts` al abrir algo:
   *   nwt → documentId = nºLibro * 1000 + capítulo  → capítulo bíblico
   *   resto → documentId es el docId de wol.jw.org  → publicación
   *
   * Devuelve null cuando no se puede situar con certeza; esas marcas se
   * omiten y se avisa, en vez de mandarlas a un sitio equivocado.
   */
  const buildLocation = (mark: { document_id: number; publication_key: string }) => {
    if (mark.publication_key === "nwt") {
      const bookNumber = Math.floor(mark.document_id / 1000);
      const chapterNumber = mark.document_id % 1000;
      if (bookNumber < 1 || bookNumber > 66 || chapterNumber < 1) return null;
      return {
        book_number: bookNumber,
        chapter_number: chapterNumber,
        key_symbol: "nwtsty",
        meps_language: 1,
      };
    }

    // El texto del día no tiene un documento propio en JW Library.
    if (mark.publication_key === "es") return null;

    return { document_id: mark.document_id, meps_language: 1 };
  };

  const buildExportRequest = (): ExportRequestDTO => {
    const exportableNotes = notesRepository.getAllForExport();
    const notesByMark = new Map(
      exportableNotes.filter((note) => note.mark_id).map((note) => [note.mark_id!, note]),
    );

    const marks = marksRepository.getAll().flatMap((mark) => {
      const location = buildLocation(mark);
      if (!location) return [];

      const note = notesByMark.get(mark.mark_id);
      // BlockType 2 = versículo (Biblia), 1 = párrafo.
      const blockType = mark.publication_key === "nwt" ? 2 : 1;

      return [{
        local_id: mark.mark_id,
        // El id local hace de UserMarkGuid: reexportar actualiza la misma
        // marca en vez de duplicarla.
        guid: mark.mark_id,
        location,
        color: COLOR_INDEX[mark.color] ?? 1,
        style: 0,
        // Sin start_token/end_token a propósito: la tokenización de JW
        // Library no es partir por espacios y todavía no se conoce. Mandar
        // números inventados pondría el subrayado en palabras equivocadas.
        ranges: [{ identifier: mark.block_id, block_type: blockType }],
        ...(note ? { note: {
          guid: note.note_id,
          title: note.title,
          content: note.content,
          last_modified: new Date(note.last_modified * 1000).toISOString(),
        } } : {}),
      }];
    });

    const markIndex = new Map(marks.map((mark, index) => [mark.local_id, index]));
    const noteToMark = new Map(
      exportableNotes.filter((note) => note.mark_id).map((note) => [note.note_id, note.mark_id!]),
    );

    return {
      marks,
      tags: tagsRepository.getAll().map((tag) => ({ name: tag.name, tag_type: 1 })),
      note_tag_links: tagsRepository.getAllNoteTagLinks().flatMap((link) => {
        const markId = noteToMark.get(link.note_id);
        const index = markId ? markIndex.get(markId) : undefined;
        return index === undefined ? [] : [{ note_mark_index: index, tag_name: link.name }];
      }),
    };
  };

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
      const request = buildExportRequest();
      const blob = await jwlibraryClient.exportToFile(file, request);
      jwlibraryClient.downloadBlob(blob, "study-export.jwlibrary");
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

        {/* Antes había aquí un botón «Crear .jwlibrary nuevo». Se ha quitado:
            restaurar en JW Library REEMPLAZA todos los datos del dispositivo,
            así que un archivo creado desde cero borraría todo lo que tienes
            en el móvil. El único camino seguro es partir de tu backup. */}
        <p className="font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
          Parte siempre de un backup recién exportado del móvil: al restaurar,
          JW Library reemplaza todos los datos del dispositivo, y así conservas
          lo que ya tenías más lo que hagas aquí.
        </p>
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
