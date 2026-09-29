import type { InputHTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-semibold text-ink", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "focus-ring h-11 w-full border border-ink/40 bg-elevated px-3 text-sm text-ink placeholder:text-muted transition-all duration-300 ease-in-out",
        className
      )}
      {...props}
    />
  );
}
