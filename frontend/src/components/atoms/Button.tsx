import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

type Variant = "primary" | "ghost" | "outline";
type Size = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-amber-600 text-paper-50 hover:bg-amber-700 active:bg-amber-800 dark:bg-amber-700 dark:hover:bg-amber-600",
  ghost:
    "bg-transparent text-reading-light/70 hover:text-reading-light hover:bg-paper-200 dark:text-reading-dark/70 dark:hover:text-reading-dark dark:hover:bg-ink-50",
  outline:
    "border border-seam-light bg-transparent text-reading-light hover:border-amber-600 hover:text-amber-700 dark:border-seam-dark dark:text-reading-dark dark:hover:border-amber-600 dark:hover:text-amber-500",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs tracking-wide",
  md: "h-10 px-4 text-sm tracking-wide",
  icon: "h-9 w-9 p-0",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-ui font-medium",
        "transition-colors duration-200 ease-[var(--ease-out-expo)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
