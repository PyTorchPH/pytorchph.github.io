import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export const badgeVariants = cva("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold", {
  variants: { variant: {
    default: "border-border bg-elevated text-muted",
    secondary: "border-border bg-surface text-ink",
    outline: "border-border bg-transparent text-ink",
    destructive: "border-danger/30 bg-danger/10 text-danger",
    orange: "border-accent/30 bg-accentSoft text-accent",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    locked: "border-border bg-elevated text-muted",
  } },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
