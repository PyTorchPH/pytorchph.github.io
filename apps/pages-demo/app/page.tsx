"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { enterAs } from "./demo-api";

const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? "").replace(/\/$/, "");

// The public site lives at the Pages root; restore a valid API session before showing sign in.
export default function PortalEntryPage() {
  const router = useRouter();
  useEffect(() => {
    if (!API_ORIGIN) { router.replace("/login/"); return; }
    const controller = new AbortController();
    void fetch(`${API_ORIGIN}/auth/me`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return router.replace("/login/");
        const viewer = await response.json() as { role: string };
        if (!controller.signal.aborted) enterAs(viewer.role === "officer" || viewer.role === "admin" ? "officer" : "member");
      })
      .catch(() => { if (!controller.signal.aborted) router.replace("/login/"); });
    return () => controller.abort();
  }, [router]);
  return <main className="flex min-h-screen items-center justify-center p-6 text-sm">
    <div className="space-y-2 text-center"><p role="status">Checking your session…</p><Link className="underline" href="/login/">Continue to sign in</Link></div>
  </main>;
}
