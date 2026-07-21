import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface BadgeProps {
  children: ReactNode;
  className?: string;
  /** Color del acento */
  tone?: "amber" | "muted" | "neutral";
}

const TONES = {
  amber:
    "bg-amber-50 text-amber-800 dark:bg-amber-800/30 dark:text-amber-300",
  muted:
    "bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark",
  neutral:
    "bg-transparent text-reading-light/60 dark:text-reading-dark/60 ring-1 ring-seam-light dark:ring-seam-dark",
} as const;

export function Badge({ children, className, tone = "muted" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
        "font-ui text-[10px] font-medium uppercase tracking-[0.12em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
