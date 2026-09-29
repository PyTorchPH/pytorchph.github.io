import type { HTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn("relative rounded-xl border border-border bg-surface p-4 text-sm", className)} role="alert" {...props} />; }
export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) { return <h5 className={cn("font-semibold", className)} {...props} />; }
export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) { return <p className={cn("mt-1 leading-6 text-muted", className)} {...props} />; }
