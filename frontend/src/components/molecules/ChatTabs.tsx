import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useChatStore } from "@/store/chatStore";

/**
 * ChatTabs — la tira de conversaciones abiertas.
 *
 * ── Por qué pestañas y no otro cajón ──
 *
 * El cajón ya existía y sigue siendo el sitio del historial completo, pero un
 * cajón no puede resolver esto: hace falta ver DE UN VISTAZO cuál está
 * generando sin abrir nada, y saltar entre dos conversaciones con un toque, no
 * con tres. Eso pide chrome permanente, y la tira es lo más barato que lo da.
 *
 * ── Por qué solo a partir de la segunda ──
 *
 * Con una sola conversación abierta la tira no se pinta. El chat de siempre
 * —que es como se usa la app el 90% del tiempo— conserva sus 44px de alto para
 * mensajes y no gana ni un elemento nuevo en pantalla. La tira es el precio de
 * abrir la segunda, y solo entonces.
 *
 * ── Por qué scroll horizontal y no repartir el ancho ──
 *
 * A 390px, cinco pestañas repartidas dan 74px cada una: descontando el punto
 * de "generando" y la aspa, quedan cuatro caracteres de título, que no
 * identifican nada. Con ancho fijo y scroll caben tres legibles y las demás
 * están a un desliz; la activa se trae sola a la vista al cambiar.
 */
export function ChatTabs() {
  const openIds = useChatStore((s) => s.openIds);

  if (openIds.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="Conversaciones abiertas"
      className={cn(
        "flex h-11 shrink-0 items-stretch overflow-x-auto overscroll-x-contain short:h-10",
        "border-b border-seam-light bg-paper-50 dark:border-seam-dark dark:bg-ink-100",
        // La barra de scroll del navegador mide 10px: dentro de una tira de
        // 44px se comería una cuarta parte del alto de las pestañas.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {openIds.map((conversationId) => (
        <ChatTab key={conversationId} conversationId={conversationId} />
      ))}
    </div>
  );
}

function ChatTab({ conversationId }: { conversationId: string }) {
  // Suscripciones a valores sueltos y no a la sesión entera: el objeto de la
  // sesión se sustituye en CADA token que llega, así que suscribirse a él
  // repintaría las cinco pestañas decenas de veces por segundo.
  const title = useChatStore((s) => s.sessions[conversationId]?.title ?? "");
  const streaming = useChatStore(
    (s) => s.sessions[conversationId]?.isStreaming ?? false,
  );
  const active = useChatStore((s) => s.activeId === conversationId);

  const [confirmClose, setConfirmClose] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // La pestaña activa puede quedar fuera de la parte visible de la tira si se
  // llegó a ella desde el cajón. `inline: nearest` desplaza lo justo.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  const close = () => {
    // Cerrar una que está generando corta su turno y guarda lo escrito hasta
    // ahí, así que se pide confirmación con un segundo toque —el mismo gesto
    // que borrar en el cajón—. Bloquear el botón sería peor: una pestaña
    // atascada tiene que poder cerrarse.
    if (streaming && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    useChatStore.getState().closeConversation(conversationId);
  };

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex w-[7.75rem] shrink-0 items-stretch",
        "border-r border-seam-light dark:border-seam-dark",
        active && "bg-amber-50/70 dark:bg-amber-800/15",
      )}
    >
      <button
        role="tab"
        aria-selected={active}
        aria-label={`${title || "Conversación"}${streaming ? " · generando" : ""}`}
        onClick={() => useChatStore.getState().openConversation(conversationId)}
        className="flex min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-0.5 text-left"
      >
        {streaming && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-600 dark:bg-amber-500"
          />
        )}
        <span
          className={cn(
            "truncate font-ui text-xs",
            active
              ? "font-medium text-amber-800 dark:text-amber-300"
              : "text-muted-light dark:text-muted-dark",
          )}
        >
          {title || "Conversación"}
        </span>
      </button>

      <button
        onClick={close}
        onBlur={() => setConfirmClose(false)}
        aria-label={
          confirmClose
            ? "Confirmar: cerrar y detener la respuesta"
            : `Cerrar ${title || "la conversación"}`
        }
        // 32px de ancho y no 44: son 44 de alto, y a cinco pestañas los 44
        // completos dejarían el título en dos caracteres.
        className={cn(
          "flex w-8 shrink-0 items-center justify-center font-ui text-base leading-none",
          confirmClose
            ? "bg-red-600 text-paper-50"
            : "text-muted-light/70 dark:text-muted-dark/70",
        )}
      >
        ×
      </button>

      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-600 dark:bg-amber-500"
        />
      )}
    </div>
  );
}
