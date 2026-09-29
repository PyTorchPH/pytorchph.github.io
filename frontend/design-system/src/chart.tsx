import type { HTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export type ChartConfig = Record<string, { color?: string; label: string }>;

export function ChartContainer({ className, config, style, ...props }: HTMLAttributes<HTMLDivElement> & { config: ChartConfig }) {
  const variables = Object.fromEntries(Object.entries(config).filter(([, value]) => value.color).map(([key, value]) => [`--color-${key}`, value.color])) as React.CSSProperties;
  return <div className={cn("relative flex w-full justify-center text-xs [&_.recharts-surface]:outline-none", className)} role="img" style={{ ...variables, ...style }} {...props} />;
}
