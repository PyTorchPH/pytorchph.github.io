"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@pytorch-ph/domain-client/public-site";

const routes = [
  ["/dashboard/", "Member dashboard"],
  ["/admin/dashboard/", "Officer dashboard"],
  ["/events/", "Events"],
  ["/leaderboards/", "Leaderboard"],
] as const;

export function DemoShell({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState("");
  return <main className="min-h-screen bg-[#0d0d0d] pb-24 text-[#FFF7ED]">
    <header className="border-b border-white/10 px-5 py-5"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><BrandMark /><Link className="text-sm text-orange-400" href="/login/">Change example account</Link></div></header>
    <div className="mx-auto grid max-w-7xl gap-7 px-5 py-8 lg:grid-cols-[210px_1fr]" onClickCapture={(event) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor) return;
      const path = new URL(anchor.href).pathname.replace(/^\/pytorch-fit-system/, "");
      if (routes.some(([href]) => href === path) || ["/", "/login/", "/register/", "/dashboard/profile/"].includes(path)) return;
      event.preventDefault();
      setNotice("This section is shown for layout preview only; no account or backend action is available here.");
    }}>
      <nav aria-label="Demo workspace" className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">{routes.map(([href, label]) => <Link className="rounded-xl border border-white/10 px-4 py-3 text-sm text-[#FFF7ED]/75 hover:border-orange-500/40 hover:text-orange-400" href={href} key={href}>{label}</Link>)}</nav>
      <div className="min-w-0 space-y-4">{notice && <p role="status" className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-sm">{notice}</p>}{children}</div>
    </div>
  </main>;
}
