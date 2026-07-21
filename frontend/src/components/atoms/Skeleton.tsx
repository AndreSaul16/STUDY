import { cn } from "@/utils/cn";

interface SkeletonProps {
  className?: string;
  /** Aspecto del skeleton */
  variant?: "line" | "block" | "circle";
}

/**
 * Skeleton loader — usa el shimmer del paper scan.
 * Editorial: no son bloques grises genéricos, son líneas
 * que simulan el barrido de un escáner sobre papel.
 */
export function Skeleton({ className, variant = "line" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-sm",
        variant === "line" && "h-4 w-full",
        variant === "block" && "h-24 w-full rounded-md",
        variant === "circle" && "h-10 w-10 rounded-full",
        className,
      )}
      aria-hidden
    />
  );
}

/** Conjunto de skeletons que imitan la estructura de una referencia */
export function ReferenceSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="space-y-2.5 pt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[92%]" />
        <Skeleton className="h-4 w-[97%]" />
        <Skeleton className="h-4 w-[85%]" />
        <Skeleton className="h-4 w-[94%]" />
        <Skeleton className="h-4 w-[78%]" />
      </div>
      <div className="pt-3">
        <Skeleton variant="block" className="h-20" />
      </div>
    </div>
  );
}
