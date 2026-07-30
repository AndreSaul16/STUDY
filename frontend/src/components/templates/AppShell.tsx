import { useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useKeyboardOpen } from "@/hooks/useVisualViewport";
import { useUIStore } from "@/store/uiStore";
import { useReaderStore } from "@/store/readerStore";
import { APP_VIEWS } from "@/types/domain";
import { SplitLayout } from "@/components/templates/SplitLayout";
import { ChatScreen } from "@/components/organisms/ChatScreen";
import { MoreScreen } from "@/components/organisms/MoreScreen";
import { BiblePanel } from "@/components/organisms/BiblePanel";
import { ReaderPanel } from "@/components/organisms/ReaderPanel";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";
import { BottomSheet } from "@/components/organisms/BottomSheet";
import { BottomNav } from "@/components/molecules/BottomNav";

/**
 * AppShell — la raíz de la app. Sustituye a SplitLayout en App.tsx.
 *
 * El cambio de fondo: la app ya no arranca en el lector con el chat escondido
 * en la pestaña novena de un bottom sheet. Arranca en el chat, que es el
 * producto, y la lectura es uno de los cuatro destinos.
 *
 * En escritorio la vista "leer" reutiliza `SplitLayout` tal cual: ese layout
 * está bien resuelto y no había motivo para tocarlo.
 */
export function AppShell() {
  const isMobile = useIsMobile();
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const article = useReaderStore((s) => s.article);
  const keyboardOpen = useKeyboardOpen();

  // Abrir un artículo desde el chat (una fuente, una cita) tiene que llevarte
  // a leerlo. La navegación se decide aquí y no en cada chip.
  const hadArticle = useRef(article !== null);
  useEffect(() => {
    const has = article !== null;
    if (has && !hadArticle.current) setView(APP_VIEWS.READ);
    hadArticle.current = has;
  }, [article, setView]);

  if (isMobile) {
    // La barra inferior se esconde con el teclado abierto; el hueco que
    // reserva el contenido tiene que irse con ella o queda una franja muerta
    // de 56 px justo encima del teclado.
    const navPadding = keyboardOpen ? "" : "pb-14";

    return (
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          {view === APP_VIEWS.CHAT && <ChatScreen className={`h-full ${navPadding}`} />}

          {view === APP_VIEWS.BIBLE && <BiblePanel className={`h-full ${navPadding}`} />}

          {/* Solo en la vista de lectura se monta el lector: fuera de ella
              pagaríamos su render y su useTextSelection para nada. */}
          {view === APP_VIEWS.READ && (
            <>
              <ReaderPanel className="h-full" />
              <BottomSheet />
            </>
          )}

          {view === APP_VIEWS.MORE && <MoreScreen className="h-full" />}
        </div>

        <BottomNav />
      </div>
    );
  }

  if (view === APP_VIEWS.CHAT) {
    return (
      <div className="flex h-dvh w-full overflow-hidden">
        <div className="h-full min-w-0 shrink-0" style={{ width: "55%" }}>
          <ChatScreen className="h-full" />
        </div>

        {/* Divisor — costura vertical */}
        <div className="h-full w-px shrink-0 bg-seam-light dark:bg-seam-dark" />

        <div className="h-full min-w-0 flex-1">
          <ResearchPanel className="h-full" />
        </div>
      </div>
    );
  }

  return <SplitLayout />;
}
