import { ChatScreen } from "@/components/organisms/ChatScreen";

interface ChatPanelProps {
  className?: string;
}

/**
 * ChatPanel — el chat dentro de la pestaña del panel de investigación.
 *
 * Envoltorio delgado de `ChatScreen`. Se conserva porque `ResearchPanel` lo
 * importa por nombre; `embedded` quita la cabecera y el cajón de
 * conversaciones, que en un panel de 35 % de ancho sobran (ahí el chat es un
 * accesorio, no la pantalla principal).
 */
export function ChatPanel({ className }: ChatPanelProps) {
  return <ChatScreen embedded className={className} />;
}
