"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return <Sonner position="bottom-right" richColors theme="dark" toastOptions={{ className: "border-border bg-surface text-ink" }} />;
}
