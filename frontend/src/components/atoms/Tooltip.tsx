import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Tooltip puro CSS — aparece en hover/focus.
 * Sin portal, sin JS de posicionamiento; usa absolute + transform.
 * El padre debe ser position-relative.
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
  className,
}: TooltipProps) {
  const POSITIONS = {
    top: "bottom-full left-1/2 -translate-x-1/2 -translate-y-2",
    bottom: "top-full left-1/2 -translate-x-1/2 translate-y-2",
    left: "right-full top-1/2 -translate-y-1/2 -translate-x-2",
    right: "left-full top-1/2 -translate-y-1/2 translate-x-2",
  } as const;

  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50",
          "rounded-md bg-ink-200 px-2 py-1 text-[11px] font-ui text-paper-50",
          "opacity-0 scale-95 transition-all duration-150 ease-[var(--ease-out-expo)]",
          "group-hover:opacity-100 group-hover:scale-100",
          "group-focus-within:opacity-100 group-focus-within:scale-100",
          POSITIONS[side],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** Hook para tooltips controlados por click (persistente) */
export function useClickTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const open = useRef(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ref.current.style.opacity = "0";
        open.current = false;
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return { ref, open };
}
