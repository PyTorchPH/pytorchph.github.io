"use client";

import type { ReactNode } from "react";
import { Dialog } from "radix-ui";

export function Sheet({ children, onOpenChange, open }: { children: ReactNode; onOpenChange: (open: boolean) => void; open: boolean }) {
  return <Dialog.Root onOpenChange={onOpenChange} open={open}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/65 lg:hidden" /><Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-72 shadow-2xl focus:outline-none lg:hidden"><Dialog.Title className="sr-only">Application navigation</Dialog.Title>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
