import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { splitChatSegments } from "@/utils/chatSegments";
import { MarkdownWithRefs } from "@/components/atoms/MarkdownWithRefs";
import { SourceChips } from "@/components/molecules/SourceChips";
import type { ChatUiMessage } from "@/types/chat";

interface ChatMessageProps {
  message: ChatUiMessage;
  /** Se está escribiendo ahora mismo: cursor parpadeante y sin pie. */
  streaming?: boolean;
}

/**
 * ChatMessage — un turno de la conversación.
 *
 * Dos decisiones de fondo frente a la burbuja anterior:
 *
 *  1. **El asistente no lleva burbuja.** Una respuesta de 400 palabras dentro
 *     de una burbuja al 88 % con esquinas redondeadas es ilegible en un móvil.
 *     Ocupa el ancho de la columna, con tipografía de lectura. La burbuja se
 *     queda solo para el mensaje del usuario, que es corto y va a la derecha.
 *  2. **Las citas de bloque salen en su propia tarjeta.** Ese es el artefacto
 *     que el usuario va a copiar y pegar en las notas de la reunión; hundido
 *     en el cuerpo del texto había que pescarlo con el dedo.
 */
export function ChatMessage({ message, streaming = false }: ChatMessageProps) {
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
            <QuoteCard key={i} markdown={segment.markdown} />
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

      {!streaming && message.sources.length > 0 && (
        <MessageSources sources={message.sources} />
      )}
    </article>
  );
}

/**
 * Tarjeta de la pieza redactada (el comentario, la oración, el guion).
 *
 * Borde ámbar y tipografía de lectura: se distingue del análisis que la rodea
 * y se ve a la primera que ESO es lo que hay que leer en voz alta.
 */
function QuoteCard({ markdown }: { markdown: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-amber-600/40 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-900/10">
      <div className="px-4 py-3 font-reading text-[16px] leading-relaxed text-reading-light dark:text-reading-dark">
        <MarkdownWithRefs>{markdown}</MarkdownWithRefs>
      </div>
    </div>
  );
}

/** Las fuentes, plegadas: en móvil una fila de chips siempre visible pesa. */
function MessageSources({ sources }: { sources: ChatUiMessage["sources"] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 max-w-[68ch]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex h-11 items-center gap-1.5 rounded-full px-3 -ml-3",
          "font-ui text-xs text-muted-light",
          "hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark",
        )}
      >
        {open ? "Ocultar fuentes" : `Fuentes (${sources.length})`}
      </button>
      {open && <SourceChips sources={sources} className="mt-1" />}
    </div>
  );
}
