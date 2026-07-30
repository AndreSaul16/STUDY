import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { useChatStore } from "@/store/chatStore";
import { APP_VIEWS } from "@/types/domain";
import type { AppView } from "@/types/domain";
import {
  IconBook,
  IconBookmark,
  IconChat,
  IconLayers,
} from "@/components/atoms/Icons";

/**
 * DesktopRail — los mismos cuatro destinos que la barra inferior del móvil,
 * en una columna de 68px a la izquierda.
 *
 * Sin esto, a partir de 768px la app se quedaba sin navegación: `BottomNav`
 * es `md:hidden`, así que las vistas "biblia" y "más" no se podían alcanzar
 * (caían en `SplitLayout`) y con ellas se perdían los ajustes, el tema, el
 * modo por defecto y la exportación de la base. La funcionalidad estaba
 * escrita pero era inaccesible en pantalla grande.
 */

interface RailItem {
  id: AppView;
  label: string;
  icon: typeof IconChat;
}

const ITEMS: RailItem[] = [
  { id: APP_VIEWS.CHAT, label: "Chat", icon: IconChat },
  { id: APP_VIEWS.BIBLE, label: "Biblia", icon: IconBook },
  { id: APP_VIEWS.READ, label: "Leer", icon: IconBookmark },
  { id: APP_VIEWS.MORE, label: "Más", icon: IconLayers },
];

export function DesktopRail() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);

  const go = (item: RailItem) => {
    // Mismo gesto que en la barra inferior: repulsar Chat estando en el chat
    // baja al final, o abre una conversación nueva si está vacía.
    if (item.id === APP_VIEWS.CHAT && view === APP_VIEWS.CHAT) {
      const chat = useChatStore.getState();
      if (chat.messages.length === 0) chat.newConversation();
      else window.dispatchEvent(new CustomEvent("study:chat-scroll-bottom"));
      return;
    }
    setView(item.id);
  };

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "flex h-full w-[68px] shrink-0 flex-col items-center gap-1 py-3",
        "border-r border-seam-light bg-paper-50",
        "dark:border-seam-dark dark:bg-ink-100",
      )}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = view === item.id;

        return (
          <button
            key={item.id}
            onClick={() => go(item)}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-xl",
              "transition-colors duration-200 ease-[var(--ease-out-expo)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
              isActive
                ? "bg-amber-50 text-amber-700 dark:bg-amber-800/20 dark:text-amber-400"
                : "text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-50 dark:hover:text-reading-dark",
            )}
          >
            <Icon width={19} height={19} />
            <span className="font-ui text-[10px] leading-none tracking-wide">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
