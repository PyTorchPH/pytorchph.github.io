import Link from "next/link";
import { Flame } from "lucide-react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Link className={cn("focus-ring flex items-center gap-2 rounded-lg", className)} href="/">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent shadow-lg shadow-accent/40">
        <Flame className="text-white" size={18} />
      </div>
      <div className="font-mono text-sm tracking-tight text-ink">PYTORCH PH</div>
    </Link>
  );
}
