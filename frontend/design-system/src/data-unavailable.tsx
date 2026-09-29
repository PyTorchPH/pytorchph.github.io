"use client";

// Keeps a panel's layout on screen while its data is missing: the content dims and a small
// "Data unavailable" stamp sits on top, instead of one card replacing the whole page.
// Module map (caller-first):
//   DataUnavailable        wrapper: dims children and stamps them while `unavailable`
//   PanelsUnavailable      whole workspace: stamps each outermost Card instead of one big stamp
//   UnavailableStamp      the centered stamp (also usable inside an existing relative card)

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

type DataUnavailableProps = { unavailable: boolean; children: ReactNode; className?: string; label?: string };

export function DataUnavailable({ unavailable, children, className, label = "Data unavailable" }: DataUnavailableProps) {
  if (!unavailable) return <>{children}</>;
  return <div className={cn("relative", className)}>
    <div aria-hidden="true" className="pointer-events-none select-none opacity-35">{children}</div>
    <UnavailableStamp label={label} />
  </div>;
}

// For whole workspaces: every outermost Card inside gets its own stamp (styled in globals.css).
export function PanelsUnavailable({ unavailable, children, label = "Data unavailable" }: Omit<DataUnavailableProps, "className">) {
  if (!unavailable) return <>{children}</>;
  return <div aria-busy={label !== "Data unavailable"} data-panels-unavailable="" style={{ "--unavailable-label": JSON.stringify(label) } as CSSProperties}>
    <span className="sr-only" role="status">{label}</span>
    {children}
  </div>;
}

export function UnavailableStamp({ label = "Data unavailable" }: { label?: string }) {
  return <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
    <span className="border border-border bg-canvas/85 px-5 py-2 font-mono text-xs uppercase tracking-[0.18em] text-muted shadow-xl">{label}</span>
  </div>;
}
