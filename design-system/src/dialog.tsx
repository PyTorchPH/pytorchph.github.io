"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { Button } from "./button";

export function AppDialog({ children, className, description, onClose, open = true, title, wide = false }: {
  children: ReactNode;
  className?: string;
  description: string;
  onClose: () => void;
  open?: boolean;
  title: string;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-slate-950/65 backdrop-blur-sm" />
        <DialogPrimitive.Content className={cn(
          "fixed inset-x-0 bottom-0 z-[81] max-h-[96dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl focus:outline-none sm:inset-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          wide ? "sm:max-w-6xl" : "sm:max-w-2xl",
          className
        )}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
            <div>
              <DialogPrimitive.Title className="text-lg font-bold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild><Button aria-label="Close" size="icon" variant="ghost"><X size={18} /></Button></DialogPrimitive.Close>
          </header>
          <div className="p-5 sm:p-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
