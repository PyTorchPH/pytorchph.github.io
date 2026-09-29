"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Progress({ "aria-label": ariaLabel = "Progress", className, indicatorClassName, value = 0 }: { "aria-label"?: string; className?: string; indicatorClassName?: string; value?: number }) {
  const safe = Math.min(100, Math.max(0, value));
  return <ProgressPrimitive.Root aria-label={ariaLabel} className={cn("relative h-2 w-full overflow-hidden bg-elevated", className)} value={safe}><ProgressPrimitive.Indicator className={cn("h-full bg-accent transition-transform", indicatorClassName)} style={{ transform: `translateX(-${100 - safe}%)` }} /></ProgressPrimitive.Root>;
}
