import type { HTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-elevated", className)} {...props} />;
}
