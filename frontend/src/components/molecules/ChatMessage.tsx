import { useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { splitChatSegments } from "@/utils/chatSegments";
import {
  markdownToPlainText,
  segmentsToPlainText,
  sourcesToPlainText,
} from "@/utils/plainText";
import { canShare, useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { proposeIllustrationPrompt } from "@/utils/illustrationPrompt";
import { CopyButton } from "@/components/atoms/CopyButton";
import { MarkdownWithRefs } from "@/components/atoms/MarkdownWithRefs";
import { ChatImage } from "@/components/molecules/ChatImage";
import { IllustrateSheet } from "@/components/molecules/IllustrateSheet";
import { SourceChips } from "@/components/molecules/SourceChips";
import {
  listImagesForMessage,
  type ChatImageRow,
} from "@/db/repositories/imagesRepository";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useChatStore } from "@/store/chatStore";
import { shortModelLabel } from "@/types/aiSettings";
import type { ChatSource, ChatUiMessage } from "@/types/chat";

interface ChatMessageProps {
  message: ChatUiMessage;
  /** Se está escribiendo ahora mismo: cursor parpadeante y sin pie. */
  streaming?: boolean;
  /** Último del asistente: solo ese ofrece reintentar. */
  isLast?: boolean;
  onRetry?: () => void;
}

/**
 * ChatMessage — un turno de la conversación.
 *
 * Tres decisiones de fondo frente a la burbuja anterior:
 *
 *  1. **El asistente no lleva burbuja.** Una respuesta de 400 palabras dentro
 *     de una burbuja al 88 % con esquinas redondeadas es ilegible en un móvil.
 *     Ocupa el ancho de la columna, con tipografía de lectura. La burbuja se
 *     queda solo para el mensaje del usuario, que es corto y va a la derecha.
 *  2. **Las citas de bloque salen en su propia tarjeta, con su botón de
 *     copiar.** Ese es el artefacto que el usuario va a pegar en las notas de
 *     la reunión; hundido en el cuerpo del texto había que pescarlo con el dedo.
 *  3. **Pie con acciones táctiles.** Copiar, compartir y reintentar: hasta
 *     ahora no había una sola acción de copiar en toda la app.
 */
export function ChatMessage({
  message,
  streaming = false,
  isLast = false,
  onRetry,
}: ChatMessageProps) {
  const segments = useMemo(
    () => splitChatSegments(message.content),
    [message.content],
  );

  if (message.role === "user") {
    return (
      <div className="mb-5 flex justify-end">
        <div className="min-w-0 max-w-[85%] break-words rounded-2xl bg-amber-600 px-4 py-2.5 text-paper-50 dark:bg-amber-700">
          <p className="whitespace-pre-wrap font-reading text-[15px] leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="mb-6">
      <div className="min-w-0 max-w-[68ch] break-words font-reading text-[15px] leading-relaxed">
        {segments.map((segment, i) =>
          segment.kind === "quote" ? (
            <QuoteCard key={i} markdown={segment.markdown} plain={segment.plain} />
          ) : (
            <MarkdownWithRefs key={i}>{segment.markdown}</MarkdownWithRefs>
          ),
        )}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-amber-600 align-middle dark:bg-amber-400"
            aria-hidden
          />
        )}
      </div>

      {!streaming && (
        <MessageFooter
          message={message}
          plain={() => segmentsToPlainText(segments)}
          isLast={isLast}
          onRetry={onRetry}
        />
      )}

      {!streaming && <MessageIllustrations message={message} />}
    </article>
  );
}

// ─── Ilustraciones ───────────────────────────────────────────────

/**
 * Las ilustraciones de este mensaje, más el botón para generar una.
 *
 * Vive aparte del pie porque tiene estado propio (la hoja, la lista) y porque
 * la mayoría de los mensajes no tienen ninguna: así el caso común no paga ni
 * una consulta de más de la cuenta.
 */
function MessageIllustrations({ message }: { message: ChatUiMessage }) {
  const conversationId = useChatStore((s) => s.conversationId);
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);

  const [images, setImages] = useState<ChatImageRow[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    try {
      setImages(listImagesForMessage(message.id));
    } catch {
      // Base aún no lista o mensaje en streaming: sin imágenes y sin ruido.
    }
  }, [message.id]);

  const provider = providers.find((p) => p.id === settings.provider);
  // Solo se ofrece si el proveedor activo genera imágenes: un botón que lleva
  // a un error es peor que ningún botón.
  const canIllustrate = Boolean(provider?.supports_images && conversationId);

  if (!canIllustrate && images.length === 0) return null;

  return (
    <div className="max-w-[68ch]">
      {images.map((image) => (
        <ChatImage
          key={image.imageId}
          image={image}
          onDeleted={(imageId) =>
            setImages((current) => current.filter((i) => i.imageId !== imageId))
          }
          onRegenerate={() => setSheetOpen(true)}
        />
      ))}

      {canIllustrate && (
        <button
          onClick={() => setSheetOpen(true)}
          className="-ml-2 mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
        >
          {images.length > 0 ? "Otra ilustración" : "Ilustrar esta respuesta"}
        </button>
      )}

      {conversationId && (
        <IllustrateSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          conversationId={conversationId}
          messageId={message.id}
          initialPrompt={proposeIllustrationPrompt(message.content)}
          onGenerated={(image) => setImages((current) => [...current, image])}
        />
      )}
    </div>
  );
}

/**
 * Tarjeta de la pieza redactada (el comentario, la oración, el guion).
 *
 * Borde ámbar y tipografía de lectura: se distingue del análisis que la rodea
 * y se ve a la primera que ESO es lo que hay que leer en voz alta. El botón de
 * copiar entrega el texto SIN el `>`, sin las negritas y sin las comillas
 * envolventes: listo para pegar.
 */
function QuoteCard({ markdown, plain }: { markdown: string; plain: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-amber-600/40 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-900/10">
      <div className="flex items-center justify-between gap-2 border-b border-amber-600/20 px-2 py-1 dark:border-amber-500/20">
        <span className="pl-2 font-ui text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
          Para leer en voz alta
        </span>
        <CopyButton getText={() => plain} label="Copiar comentario" />
      </div>
      <div className="px-4 py-3 font-reading text-[16px] leading-relaxed text-reading-light dark:text-reading-dark">
        <MarkdownWithRefs>{markdown}</MarkdownWithRefs>
      </div>
    </div>
  );
}

// ─── Pie del mensaje ─────────────────────────────────────────────

function MessageFooter({
  message,
  plain,
  isLast,
  onRetry,
}: {
  message: ChatUiMessage;
  plain: () => string;
  isLast: boolean;
  onRetry?: () => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { copy } = useCopyToClipboard();

  const share = async () => {
    const text = plain();
    if (canShare()) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // Cancelado o no permitido: se degrada a copiar, que siempre sirve.
      }
    }
    await copy(text);
  };

  return (
    <div className="mt-2 max-w-[68ch]">
      <div className="-ml-2 flex flex-wrap items-center gap-1">
        <CopyButton getText={plain} />

        {canShare() && (
          <button
            onClick={() => void share()}
            aria-label="Compartir"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
          >
            Compartir
          </button>
        )}

        {isLast && onRetry && (
          <button
            onClick={onRetry}
            aria-label="Volver a preguntar"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
          >
            Reintentar
          </button>
        )}

        {message.sources.length > 0 && (
          <button
            onClick={() => setSourcesOpen((o) => !o)}
            aria-expanded={sourcesOpen}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark"
          >
            {sourcesOpen ? "Ocultar fuentes" : `Fuentes (${message.sources.length})`}
          </button>
        )}
      </div>

      {sourcesOpen && message.sources.length > 0 && (
        <MessageSources sources={message.sources} />
      )}

      <MessageMeta message={message} />
    </div>
  );
}

/**
 * Con qué se generó la respuesta: "gemini-3.5-flash · esfuerzo alto".
 *
 * Discreto y en el pie, pero presente: releyendo una conversación de hace un
 * mes hay que poder saber si la escribió el modelo bueno o el barato. Un
 * informe profundo además dice cuántas publicaciones leyó.
 */
function MessageMeta({ message }: { message: ChatUiMessage }) {
  const meta = message.meta;
  if (!meta?.model && !meta?.deep) return null;

  const parts = [
    meta.deep
      ? `Informe · ${meta.docs ?? 0} publicaciones`
      : shortModelLabel(meta.model ?? ""),
    meta.effort ? `esfuerzo ${meta.effort}` : "",
  ].filter(Boolean);

  return (
    <p className="mt-0.5 px-1 font-ui text-[10px] text-muted-light dark:text-muted-dark">
      {parts.join(" · ")}
    </p>
  );
}

/** Las fuentes, plegadas: en móvil una fila de chips siempre visible pesa. */
function MessageSources({ sources }: { sources: ChatSource[] }) {
  return (
    <div className="mt-1">
      <SourceChips sources={sources} />
      <CopyButton
        getText={() => sourcesToPlainText(sources)}
        label="Copiar referencias"
        className="-ml-2"
      />
    </div>
  );
}

/** Reexportado para quien necesite el texto plano de un mensaje suelto. */
export function messageToPlainText(message: ChatUiMessage): string {
  return markdownToPlainText(message.content);
}
