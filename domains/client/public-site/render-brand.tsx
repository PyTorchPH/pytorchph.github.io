import Link from "next/link";
import { Flame } from "lucide-react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Link className={cn("focus-ring flex items-center gap-2 rounded-lg", className)} href="/">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#e8590c] to-[#ff8a3d] shadow-lg shadow-[#e8590c]/40">
        <Flame className="text-white" size={18} />
      </div>
      <div className="font-mono text-sm tracking-tight text-[#FFF7ED]">PYTORCH PH</div>
    </Link>
  );
}
