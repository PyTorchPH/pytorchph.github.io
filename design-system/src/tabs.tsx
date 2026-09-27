"use client";

import type { ReactNode } from "react";
import { Tabs } from "radix-ui";
import { cn } from "@pytorch-ph/design-system/merge-classes";

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
    <Tabs.Root onValueChange={(next) => onChange(next as T)} value={value}>
      <Tabs.List className="inline-flex max-w-full gap-1 rounded-full border border-border bg-elevated p-1">
      {items.map((item) => (
        <Tabs.Trigger
          key={item.value}
          className={cn(
            "focus-ring h-8 rounded-full px-3 text-sm font-semibold transition-all duration-300 ease-in-out",
            value === item.value ? "bg-accent text-white" : "text-muted hover:text-ink"
          )}
          value={item.value}
        >
          {item.label}
        </Tabs.Trigger>
      ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function TabPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4", className)}>{children}</div>;
}
