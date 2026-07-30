import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useChatStore } from "@/store/chatStore";
import { useChatModes } from "@/components/molecules/ModePicker";
import { chatModeLabel } from "@/types/chat";
import { IconClose, IconSearch, IconStar, IconStarFilled, IconTrash } from "@/components/atoms/Icons";

/** "hace 5 min", "ayer", "12 mar" — sin librería de fechas. */
function relativeDate(seconds: number): string {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return "ayer";
  return new Date(seconds * 1000).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

/**
 * ConversationsDrawer — el historial de conversaciones.
 *
 * Sustituye al botón "Limpiar" que borraba todo sin preguntar. Aquí se abre,
 * se renombra, se fija y se borra con confirmación explícita, conversación a
 * conversación.
 */
export function ConversationsDrawer() {
  const open = useChatStore((s) => s.drawerOpen);
  const setOpen = useChatStore((s) => s.setDrawerOpen);
  const conversations = useChatStore((s) => s.conversations);
  const conversationId = useChatStore((s) => s.conversationId);
  const modes = useChatModes();
  const reducedMotion = usePrefersReducedMotion();

  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    useChatStore.getState().refreshConversations(query);
  }, [open, query]);

  // Escape cierra: en escritorio es el gesto esperado.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        aria-label="Cerrar conversaciones"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-label="Conversaciones"
        className={cn(
          "relative flex h-dvh w-[88%] max-w-[320px] flex-col",
          "border-r border-seam-light bg-paper-50 dark:border-seam-dark dark:bg-ink-100",
          "pt-[env(safe-area-inset-top)]",
          !reducedMotion && "animate-drawer-in",
        )}
      >
        <header className="flex shrink-0 items-center justify-between px-3 py-3">
          <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
            Conversaciones
          </p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light dark:text-muted-dark"
          >
            <IconClose width={18} height={18} />
          </button>
        </header>

        <div className="shrink-0 px-3 pb-2">
          <div className="flex h-11 items-center gap-2 rounded-full bg-paper-200 px-3 dark:bg-ink-50">
            <IconSearch width={15} height={15} className="shrink-0 text-muted-light dark:text-muted-dark" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar conversaciones"
              className="min-w-0 flex-1 bg-transparent font-ui text-base text-reading-light outline-none placeholder:text-muted-light/60 sm:text-sm dark:text-reading-dark"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {conversations.length === 0 && (
            <li className="px-3 py-6 text-center font-ui text-xs text-muted-light dark:text-muted-dark">
              {query ? "Sin resultados." : "Todavía no hay conversaciones."}
            </li>
          )}

          {conversations.map((conversation) => {
            const active = conversation.conversationId === conversationId;
            const pendingDelete = confirmDelete === conversation.conversationId;

            return (
              <li key={conversation.conversationId} className="mb-0.5">
                <div
                  className={cn(
                    "flex items-stretch gap-1 rounded-xl",
                    active && "bg-amber-50 dark:bg-amber-800/20",
                  )}
                >
                  <button
                    onClick={() =>
                      useChatStore.getState().openConversation(conversation.conversationId)
                    }
                    className="flex min-h-[56px] min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2 text-left"
                  >
                    <span
                      className={cn(
                        "truncate font-ui text-sm",
                        active
                          ? "font-medium text-amber-800 dark:text-amber-300"
                          : "text-reading-light dark:text-reading-dark",
                      )}
                    >
                      {conversation.title}
                    </span>
                    <span className="truncate font-ui text-[11px] text-muted-light dark:text-muted-dark">
                      {chatModeLabel(modes, conversation.mode)} ·{" "}
                      {relativeDate(conversation.updatedAt)}
                    </span>
                  </button>

                  <button
                    onClick={() => useChatStore.getState().togglePin(conversation.conversationId)}
                    aria-label={conversation.pinned ? "Dejar de fijar" : "Fijar"}
                    className="flex w-11 items-center justify-center text-muted-light dark:text-muted-dark"
                  >
                    {conversation.pinned ? (
                      <IconStarFilled width={15} height={15} className="text-amber-600 dark:text-amber-400" />
                    ) : (
                      <IconStar width={15} height={15} />
                    )}
                  </button>

                  <button
                    onClick={() =>
                      pendingDelete
                        ? useChatStore.getState().removeConversation(conversation.conversationId)
                        : setConfirmDelete(conversation.conversationId)
                    }
                    onBlur={() => pendingDelete && setConfirmDelete(null)}
                    aria-label={pendingDelete ? "Confirmar borrado" : "Eliminar"}
                    className={cn(
                      "flex w-11 items-center justify-center rounded-r-xl",
                      pendingDelete
                        ? "bg-red-600 text-paper-50"
                        : "text-muted-light dark:text-muted-dark",
                    )}
                  >
                    <IconTrash width={15} height={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="shrink-0 border-t border-seam-light p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-seam-dark">
          <button
            onClick={() => useChatStore.getState().newConversation()}
            className="flex h-12 w-full items-center justify-center rounded-full bg-amber-600 font-ui text-sm font-medium text-paper-50 active:scale-[0.98] dark:bg-amber-700"
          >
            Nueva conversación
          </button>
        </div>
      </aside>
    </div>
  );
}
