import type { TextareaHTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("focus-ring min-h-28 w-full rounded-lg border border-border bg-elevated p-3 text-sm text-ink placeholder:text-muted", className)} {...props} />;
}
