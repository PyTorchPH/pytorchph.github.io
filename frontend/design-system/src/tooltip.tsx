"use client";

import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

export function Tooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="z-[100] max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink shadow-xl" sideOffset={6}>{content}<TooltipPrimitive.Arrow className="fill-surface" /></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}
