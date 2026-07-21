import { useIsMobile } from "@/hooks/useMediaQuery";
import { ReaderPanel } from "@/components/organisms/ReaderPanel";
import { ResearchPanel } from "@/components/organisms/ResearchPanel";
import { BottomSheet } from "@/components/organisms/BottomSheet";

/**
 * SplitLayout — layout principal responsive.
 *
 * Desktop (≥768px): split-view 60/40 con un divisor visual.
 * Mobile (<768px): ReaderPanel 100%, ResearchPanel via BottomSheet.
 */
export function SplitLayout() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-dvh w-full flex-col">
        <ReaderPanel className="flex-1" />
        <BottomSheet />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full">
      {/* Panel izquierdo — 60% */}
      <div className="h-full w-[60%] shrink-0">
        <ReaderPanel className="h-full" />
      </div>

      {/* Divisor — costura vertical */}
      <div className="h-full w-px shrink-0 bg-seam-light dark:bg-seam-dark" />

      {/* Panel derecho — 40% */}
      <div className="h-full flex-1">
        <ResearchPanel className="h-full" />
      </div>
    </div>
  );
}
