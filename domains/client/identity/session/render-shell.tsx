import type { ReactNode } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";

export function AuthShell({ children, title, sub }: { children: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <div className="relative hidden flex-1 overflow-hidden border-r border-border lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgb(var(--accent-rgb)/.1),transparent_34%)]" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <Link className="focus-ring flex items-center gap-2 rounded-lg" href="/">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent shadow-lg shadow-accent/40">
              <Flame className="text-white" size={20} />
            </div>
            <div className="font-mono tracking-tight text-ink">PYTORCH PH</div>
          </Link>
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-accent">// community access</div>
            <div className="text-[2.5rem] font-bold leading-[1.05] text-ink">
              Empowering the next
              <br />
              generation of builders.
            </div>
            <div className="mt-6 max-w-md text-muted">
              PyTorch Philippines connects learners, researchers, educators, engineers, and community organizers nationwide. No school affiliation is required.
            </div>
            <div className="mt-10 flex items-center gap-4 font-mono text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />RLS-FIRST</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" />NATIONWIDE</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-info" />v0.1</span>
            </div>
          </div>
          <div className="font-mono text-xs text-muted">Copyright 2026 PYTORCH PH</div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link className="focus-ring mb-8 flex items-center gap-2 rounded-lg lg:hidden" href="/">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent">
              <Flame className="text-white" size={18} />
            </div>
            <div className="font-mono text-ink">PYTORCH PH</div>
          </Link>
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-accent">{sub}</div>
          <h1 className="mb-8 text-3xl font-bold tracking-[-0.02em] text-ink">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
