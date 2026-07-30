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
import { DesktopRail } from "@/components/molecules/DesktopRail";
import { IconBookmark } from "@/components/atoms/Icons";
import { cn } from "@/utils/cn";

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
  const researchOpen = useUIStore((s) => s.researchOpen);
  const setResearchOpen = useUIStore((s) => s.setResearchOpen);
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
    const navPadding = keyboardOpen ? "" : "pb-14 short:pb-11";

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

  // ─── Escritorio y tablet ───
  // El carril de la izquierda va en todas las vistas: sin él, "biblia" y
  // "más" no tenían forma de alcanzarse y caían silenciosamente en el lector.
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <DesktopRail />

      <div className="min-w-0 flex-1">
        {view === APP_VIEWS.CHAT && (
          <div className="flex h-full w-full overflow-hidden">
            {/* Con el panel plegado el chat ocupa todo el ancho. En la franja
                de tablet (768-1149) el reparto 55/45 deja el chat en 420px y
                el panel en 345px, y ninguno de los dos trabaja a gusto. */}
            <div
              className={cn("h-full min-w-0", researchOpen ? "shrink-0" : "flex-1")}
              style={researchOpen ? { width: "55%" } : undefined}
            >
              <ChatScreen className="h-full" />
            </div>

            {/* Divisor — costura vertical */}
            <div className="h-full w-px shrink-0 bg-seam-light dark:bg-seam-dark" />

            {researchOpen ? (
              <div className="h-full min-w-0 flex-1">
                <ResearchPanel
                  className="h-full"
                  onCollapse={() => setResearchOpen(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setResearchOpen(true)}
                aria-label="Mostrar el panel de investigación"
                className={cn(
                  "flex h-full w-11 shrink-0 flex-col items-center gap-3 pt-4",
                  "bg-paper-50 text-muted-light transition-colors",
                  "hover:text-amber-700 dark:bg-ink-100 dark:text-muted-dark dark:hover:text-amber-400",
                )}
              >
                <IconBookmark width={16} height={16} />
                <span className="font-ui text-[10px] uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
                  Investigación
                </span>
              </button>
            )}
          </div>
        )}

        {view === APP_VIEWS.BIBLE && (
          <div className="mx-auto flex h-full max-w-2xl flex-col">
            <header className="shrink-0 px-3 pt-5 short:pt-2">
              <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
                Escrituras
              </p>
              <h1 className="mt-1 font-display text-2xl leading-tight text-reading-light dark:text-reading-dark">
                Biblia
              </h1>
            </header>
            <BiblePanel className="min-h-0 flex-1" />
          </div>
        )}

        {view === APP_VIEWS.MORE && <MoreScreen className="h-full" />}

        {view === APP_VIEWS.READ && <SplitLayout />}
      </div>
    </div>
  );
}
