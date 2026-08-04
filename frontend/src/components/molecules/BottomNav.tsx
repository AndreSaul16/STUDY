import { cn } from "@/utils/cn";
import { useUIStore } from "@/store/uiStore";
import { useChatStore } from "@/store/chatStore";
import { useKeyboardOpen } from "@/hooks/useVisualViewport";
import { APP_VIEWS } from "@/types/domain";
import type { AppView } from "@/types/domain";
import {
  IconBook,
  IconBookmark,
  IconChat,
  IconLayers,
  IconMic,
} from "@/components/atoms/Icons";

/**
 * BottomNav — navegación inferior del móvil. Sustituye al antiguo MobileNav.
 *
 * Cinco destinos. Eran cuatro por una razón buena (a 390 px daban ~98 px por
 * botón en vez de 78) y ahora son cinco por otra: "Voz" se usa de pie, con el
 * móvil en la mano, y a dos toques dentro de "Más" no lo alcanzaría nadie en
 * esa postura. A 320 px —el suelo que sostiene la app— salen 64 px por botón,
 * todavía por encima de los 44 de objetivo táctil, así que el reparto aguanta.
 * El sexto ya no cabría: si algún día se añade otro, hay que replantear la
 * barra, no meterlo aquí.
 *
 * El primero sigue siendo el Chat, que es el núcleo de la app.
 *
 * Se esconde con el teclado abierto: 56 px de pantalla son mucho cuando
 * quedan 350 para escribir y leer.
 */

interface NavItem {
  id: AppView;
  label: string;
  icon: typeof IconChat;
}

const ITEMS: NavItem[] = [
  { id: APP_VIEWS.CHAT, label: "Chat", icon: IconChat },
  { id: APP_VIEWS.VOICE, label: "Voz", icon: IconMic },
  { id: APP_VIEWS.BIBLE, label: "Biblia", icon: IconBook },
  { id: APP_VIEWS.READ, label: "Leer", icon: IconBookmark },
  { id: APP_VIEWS.MORE, label: "Más", icon: IconLayers },
];

export function BottomNav() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const setSheetOpen = useUIStore((s) => s.setMobileSheetOpen);
  const keyboardOpen = useKeyboardOpen();

  if (keyboardOpen) return null;

  const go = (item: NavItem) => {
    // Repulsar Chat estando en el chat: al final de la conversación. Si ya
    // está al final (o vacía), conversación nueva. Es el gesto que la gente
    // ya espera de una barra inferior.
    if (item.id === APP_VIEWS.CHAT && view === APP_VIEWS.CHAT) {
      const chat = useChatStore.getState();
      if (chat.messages.length === 0) chat.newConversation();
      else window.dispatchEvent(new CustomEvent("study:chat-scroll-bottom"));
      return;
    }

    if (item.id !== APP_VIEWS.READ) setSheetOpen(false);
    setView(item.id);
  };

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        // Por encima del bottom sheet (z-110): con el panel abierto se tiene
        // que poder saltar de Biblia a Chat sin cerrarlo primero.
        //
        // Sin `md:hidden`: quien decide si hay barra inferior es AppShell, que
        // sabe si el layout es de una columna. Con la regla de ancho, un móvil
        // en apaisado (844×390) usaba el layout móvil y se quedaba sin barra.
        "fixed inset-x-0 bottom-0 z-[120]",
        "border-t border-seam-light bg-paper-50/95 backdrop-blur",
        "dark:border-seam-dark dark:bg-ink-100/95",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex items-stretch">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.id;

          return (
            <li key={item.id} className="flex-1">
              <button
                onClick={() => go(item)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // En apaisado la barra baja a 44px: con 390px de alto,
                  // 56 para navegar es el 14% de la pantalla.
                  "flex h-14 w-full flex-col items-center justify-center gap-1 short:h-11 short:gap-0.5",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500",
                  isActive
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-light dark:text-muted-dark",
                )}
              >
                <Icon width={19} height={19} />
                <span className="font-ui text-[10px] leading-none tracking-wide">
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
