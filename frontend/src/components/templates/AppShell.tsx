import { useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useKeyboardOpen } from "@/hooks/useVisualViewport";
import {
  RESEARCH_WIDTH_MAX,
  RESEARCH_WIDTH_MIN,
  useUIStore,
} from "@/store/uiStore";
import { useReaderStore } from "@/store/readerStore";
import { APP_VIEWS, RESEARCH_TABS } from "@/types/domain";
import { SplitLayout } from "@/components/templates/SplitLayout";
import { ChatScreen } from "@/components/organisms/ChatScreen";
import { MoreScreen } from "@/components/organisms/MoreScreen";
import { VoiceScreen } from "@/components/organisms/VoiceScreen";
import { BiblePanel } from "@/components/organisms/BiblePanel";
import { ReaderPanel } from "@/components/organisms/ReaderPanel";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";
import { BottomSheet } from "@/components/organisms/BottomSheet";
import { BottomNav } from "@/components/molecules/BottomNav";
import { DesktopRail } from "@/components/molecules/DesktopRail";
import { SplitHandle } from "@/components/molecules/SplitHandle";
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
  const researchWidth = useUIStore((s) => s.researchWidth);
  const setResearchWidth = useUIStore((s) => s.setResearchWidth);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const article = useReaderStore((s) => s.article);
  const keyboardOpen = useKeyboardOpen();

  // Abrir un artículo tiene que llevarte a leerlo, pero NO a costa de perder
  // la conversación. Si estás en el chat de escritorio con el panel abierto,
  // el artículo se abre EN el panel (pestaña "Leer") y sigues viendo lo que
  // preguntaste. Solo cuando no hay panel donde meterlo se cambia de vista,
  // que es lo que pasa en móvil y con el panel plegado.
  const puedeLeerAlLado = !isMobile && researchOpen && view === APP_VIEWS.CHAT;
  const hadArticle = useRef(article !== null);
  useEffect(() => {
    const has = article !== null;
    if (has && !hadArticle.current) {
      if (puedeLeerAlLado) setActiveTab(RESEARCH_TABS.READER);
      else setView(APP_VIEWS.READ);
    }
    hadArticle.current = has;
  }, [article, puedeLeerAlLado, setActiveTab, setView]);

  if (isMobile) {
    // La barra inferior se esconde con el teclado abierto; el hueco que
    // reserva el contenido tiene que irse con ella o queda una franja muerta
    // de 56 px justo encima del teclado.
    const navPadding = keyboardOpen ? "" : "pb-14 short:pb-11";

    return (
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          {view === APP_VIEWS.CHAT && <ChatScreen className={`h-full ${navPadding}`} />}

          {/* Solo montada cuando se está en ella: `useVoiceRecorder` pide el
              micrófono y abre un AudioContext, y eso no puede quedarse vivo
              detrás de otra pantalla. Al desmontar, su cleanup suelta las
              pistas y apaga el indicador de grabación del navegador. */}
          {view === APP_VIEWS.VOICE && <VoiceScreen className={`h-full ${navPadding}`} />}

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
            {/* Con el panel plegado el chat ocupa todo el ancho. Abierto, el
                reparto lo decide el usuario arrastrando la costura: el 55/45
                fijo dejaba el panel en 345px en tablet, donde un capítulo no
                se lee. */}
            <div className="h-full min-w-0 flex-1">
              <ChatScreen className="h-full" />
            </div>

            {researchOpen ? (
              <>
                <SplitHandle
                  value={researchWidth}
                  onChange={setResearchWidth}
                  min={RESEARCH_WIDTH_MIN}
                  max={RESEARCH_WIDTH_MAX}
                  label="Ajustar el ancho del panel de investigación"
                />
                <div
                  className="h-full min-w-0 shrink-0"
                  style={{ width: `${researchWidth}%` }}
                >
                  <ResearchPanel
                    className="h-full"
                    onCollapse={() => setResearchOpen(false)}
                  />
                </div>
              </>
            ) : (
              <>
              <div className="h-full w-px shrink-0 bg-seam-light dark:bg-seam-dark" />
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
              </>
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

        {view === APP_VIEWS.VOICE && <VoiceScreen className="h-full" />}

        {view === APP_VIEWS.MORE && <MoreScreen className="h-full" />}

        {view === APP_VIEWS.READ && <SplitLayout />}
      </div>
    </div>
  );
}
