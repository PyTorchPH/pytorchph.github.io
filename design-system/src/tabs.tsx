"use client";

import type { ReactNode } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

// A segmented filter: toggle buttons, because there is no separate tab panel to control.
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange
}: {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 rounded-full border border-border bg-elevated p-1" role="group">
      {items.map((item) => (
        <button
          aria-pressed={value === item.value}
          key={item.value}
          className={cn(
            "focus-ring h-8 rounded-full px-3 text-sm font-semibold transition-all duration-300 ease-in-out",
            value === item.value ? "bg-accent text-white" : "text-muted hover:text-ink"
          )}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4", className)}>{children}</div>;
}
