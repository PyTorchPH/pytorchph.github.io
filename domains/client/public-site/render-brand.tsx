import { PUBLIC_SITE_URL } from "@pytorch-ph/domain-protocol/organization";
import { Flame } from "lucide-react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <a aria-label="PyTorch PH: go to the pytorch.ph home page" className={cn("focus-ring flex items-center gap-2 rounded-lg", className)} href={PUBLIC_SITE_URL}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent shadow-lg shadow-accent/40">
        <Flame className="text-white" size={18} />
      </div>
      <div className="font-mono text-sm tracking-tight text-ink">PYTORCH PH</div>
    </a>
  );
}
