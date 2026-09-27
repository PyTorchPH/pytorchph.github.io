import type { ReactNode } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";

export function AuthShell({ children, title, sub }: { children: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex min-h-screen bg-[#0d0d0d] text-[#FFF7ED]">
      <div className="relative hidden flex-1 overflow-hidden border-r border-white/5 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(232,89,12,0.22),transparent_34%)]" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <Link className="focus-ring flex items-center gap-2 rounded-lg" href="/">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#e8590c] to-[#ff8a3d] shadow-lg shadow-[#e8590c]/40">
              <Flame className="text-white" size={20} />
            </div>
            <div className="font-mono tracking-tight text-[#FFF7ED]">PYTORCH PH</div>
          </Link>
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#e8590c]">// community access</div>
            <div className="text-[2.5rem] font-bold leading-[1.05] text-[#FFF7ED]">
              Empowering the next
              <br />
              generation of builders.
            </div>
            <div className="mt-6 max-w-md text-[#FFF7ED]/55">
              PyTorch Philippines connects learners, researchers, educators, engineers, and community organizers nationwide. No school affiliation is required.
            </div>
            <div className="mt-10 flex items-center gap-4 font-mono text-xs text-[#FFF7ED]/45">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-green-400" />RLS-FIRST</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#e8590c]" />NATIONWIDE</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />v0.1</span>
            </div>
          </div>
          <div className="font-mono text-xs text-[#FFF7ED]/30">Copyright 2026 PYTORCH PH</div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link className="focus-ring mb-8 flex items-center gap-2 rounded-lg lg:hidden" href="/">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#e8590c] to-[#ff8a3d]">
              <Flame className="text-white" size={18} />
            </div>
            <div className="font-mono text-[#FFF7ED]">PYTORCH PH</div>
          </Link>
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-[#e8590c]">{sub}</div>
          <h1 className="mb-8 text-3xl font-bold tracking-[-0.02em] text-[#FFF7ED]">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
