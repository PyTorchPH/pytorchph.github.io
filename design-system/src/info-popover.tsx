"use client";

import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover } from "radix-ui";
import { cn } from "@pytorch-ph/design-system/merge-classes";

const CLOSE_DELAY_MS = 150;

// Details that stay hidden until someone asks for them: opens on click, tap, keyboard, or mouse hover,
// and closes on Escape, outside click, or when the pointer leaves.
export function InfoPopover({ label, title, children, showLabel = false, className }: { label: string; title?: string; children: ReactNode; showLabel?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const hover = (next: boolean) => (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(closeTimer.current);
    if (next) setOpen(true);
    else closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger asChild>
        <button
          aria-label={showLabel ? undefined : label}
          className={cn("focus-ring inline-flex items-center gap-1.5 border border-border bg-surface text-sm font-semibold text-ink hover:border-accent hover:text-accent", showLabel ? "h-9 px-3" : "h-7 w-7 justify-center", className)}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          type="button"
        >
          <Info aria-hidden="true" size={16} />{showLabel && label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className="z-[100] w-[min(22rem,calc(100vw-2rem))] border border-border bg-surface p-4 text-sm leading-6 text-ink shadow-xl"
          collisionPadding={16}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          sideOffset={8}
        >
          {title && <p className="mb-2 font-heading font-semibold">{title}</p>}
          {children}
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
