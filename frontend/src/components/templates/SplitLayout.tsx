import { useIsMobile, useIsDesktop } from "@/hooks/useMediaQuery";
import { ReaderPanel } from "@/components/organisms/ReaderPanel";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";
import { BottomSheet } from "@/components/organisms/BottomSheet";
import { MobileNav } from "@/components/molecules/MobileNav";

/**
 * SplitLayout — layout principal, tres modos.
 *
 *   Móvil    (<768px)   lector a pantalla completa + navegación inferior;
 *                       la investigación entra por un bottom sheet.
 *   Tablet   (768-1149) split, pero el lector manda: 65/35.
 *   Escritorio (≥1150)  split holgado 60/40.
 *
 * El tramo de tablet antes no existía: a 800px se aplicaba el reparto de
 * escritorio y el panel derecho se quedaba en ~320px, con las pestañas y la
 * rejilla de capítulos apretadas contra el borde.
 */
export function SplitLayout() {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  if (isMobile) {
    return (
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        <ReaderPanel className="min-h-0 flex-1" />
        <BottomSheet />
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div
        className="h-full min-w-0 shrink-0"
        style={{ width: isDesktop ? "60%" : "65%" }}
      >
        <ReaderPanel className="h-full" />
      </div>

      {/* Divisor — costura vertical */}
      <div className="h-full w-px shrink-0 bg-seam-light dark:bg-seam-dark" />

      <div className="h-full min-w-0 flex-1">
        <ResearchPanel className="h-full" />
      </div>
    </div>
  );
}
