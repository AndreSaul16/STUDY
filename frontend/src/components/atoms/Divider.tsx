import { cn } from "@/utils/cn";

interface DividerProps {
  className?: string;
  /** Orientación */
  orientation?: "horizontal" | "vertical";
  /** Variante visual */
  variant?: "seam" | "dotted" | "amber";
}

/**
 * Divider — costura editorial, no línea gris genérica.
 * - seam: línea fina del color de las costuras del papel
 * - dotted: puntos (para separar anotaciones)
 * - amber: acento ámbar (para secciones destacadas)
 */
export function Divider({
  className,
  orientation = "horizontal",
  variant = "seam",
}: DividerProps) {
  return (
    <hr
      className={cn(
        "border-0",
        orientation === "horizontal" ? "w-full h-px" : "h-full w-px",
        variant === "seam" &&
          "bg-seam-light dark:bg-seam-dark",
        variant === "dotted" &&
          "border-t border-dotted border-seam-light dark:border-seam-dark",
        variant === "amber" && "bg-amber-600/40",
        className,
      )}
    />
  );
}
