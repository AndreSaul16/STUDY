import { cn } from "@/utils/cn";
import { useReferenceEngine } from "@/hooks/useReferenceEngine";
import { openLocalJwpubDocument, openWolDocument } from "@/services/readerActions";
import type { ChatSource } from "@/types/chat";
import {
  IconBook,
  IconBookmark,
  IconGlobe,
  IconGlossary,
  IconLink,
  IconNote,
  IconPlay,
  IconSearch,
} from "@/components/atoms/Icons";

const KIND_ICON = {
  scripture: IconBook,
  article: IconNote,
  search: IconSearch,
  daily: IconGlossary,
  video: IconPlay,
  external: IconGlobe,
  local: IconBookmark,
  mcp: IconLink,
} as const;

/**
 * Identificador de un documento de la biblioteca local: `jwpub:<símbolo>:<id>`.
 *
 * Lo compone el backend (source_tracker._from_local) con lo que le mandó este
 * mismo navegador, así que el `DocumentId` es el de una publicación que está
 * aquí y se puede abrir sin red.
 */
function parseLocal(identifier?: string): { symbol: string; documentId: number } | null {
  const match = /^jwpub:([^:]+):(\d+)$/.exec(identifier ?? "");
  if (!match) return null;
  return { symbol: match[1]!, documentId: Number(match[2]) };
}

/**
 * Lo externo se pinta distinto a propósito.
 *
 * Un chip de La Atalaya y uno de una revista científica no valen lo mismo en
 * esta app: el primero es la fuente de enseñanza y el segundo es un dato de
 * apoyo. Si se ven iguales, la distinción se pierde justo donde importa.
 */
const KIND_TONE: Partial<Record<string, string>> = {
  external:
    "bg-transparent ring-1 ring-inset ring-seam-light text-muted-light " +
    "hover:bg-paper-100 hover:text-reading-light " +
    "dark:ring-seam-dark dark:text-muted-dark dark:hover:bg-ink-50",
};

interface SourceChipsProps {
  sources: ChatSource[];
  className?: string;
}

/**
 * SourceChips — las fuentes de las que salió la respuesta, tocables.
 *
 * El valor del chat es que la respuesta viene de wol.jw.org y se puede
 * comprobar. Un chip que abre el artículo real cierra ese círculo; una lista
 * de URLs pegadas en el texto, no.
 *
 * Fila con scroll horizontal (mismo patrón que TabBar): en un móvil de 390 px
 * cinco fuentes apiladas ocuparían media pantalla.
 */
export function SourceChips({ sources, className }: SourceChipsProps) {
  const { openReference, engine } = useReferenceEngine();

  if (sources.length === 0) return null;

  const open = (source: ChatSource) => {
    // Va PRIMERO, antes de la detección de referencias: el título de un
    // documento .jwpub puede contener un versículo ("Isaías 58, un capítulo
    // para hoy") y se abriría el pasaje en lugar del libro del usuario.
    const local = parseLocal(source.identifier);
    if (local) {
      void openLocalJwpubDocument(local.symbol, local.documentId);
      return;
    }

    if (source.identifier) {
      const detected = engine.detect(source.label)[0];
      if (detected) {
        void openReference(detected.reference);
        return;
      }
    }
    if (typeof source.doc_id === "number") {
      // Abrir el artículo cambia `readerStore.article`; el shell reacciona a
      // eso y conmuta a la vista de lectura. Aquí no se decide navegación.
      void openWolDocument(source.doc_id);
      return;
    }
    if (source.url) {
      window.open(source.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto pb-1",
        "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      aria-label="Fuentes consultadas"
    >
      {sources.map((source, i) => {
        const Icon = KIND_ICON[source.kind] ?? IconLink;
        return (
          <button
            key={`${source.kind}-${source.label}-${i}`}
            onClick={() => open(source)}
            title={source.citation || source.label}
            className={cn(
              "flex h-9 min-w-0 shrink-0 max-w-[70vw] items-center gap-1.5 rounded-full px-3",
              "font-ui text-xs",
              "transition-colors duration-200 ease-[var(--ease-out-expo)]",
              "active:scale-95",
              KIND_TONE[source.kind] ??
                "bg-paper-200 text-reading-light hover:bg-amber-50 hover:text-amber-800 dark:bg-ink-50 dark:text-reading-dark dark:hover:bg-amber-800/20 dark:hover:text-amber-300",
            )}
          >
            <Icon width={13} height={13} className="shrink-0 opacity-60" />
            <span className="min-w-0 truncate">{source.label}</span>
          </button>
        );
      })}
    </div>
  );
}
