"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, QrCode, ShieldCheck, UserCheck } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { MembershipStatus } from "@pytorch-ph/domain-protocol/privacy-feedback";

function DemoQr() {
  return <div aria-label="Synthetic payment QR placeholder" className="relative grid h-48 w-48 grid-cols-9 gap-1 rounded-xl bg-white p-4" role="img">{Array.from({ length: 81 }, (_, index) => <span className={(index * 7 + Math.floor(index / 9) * 3) % 5 < 2 ? "bg-black" : "bg-white"} key={index} />)}<span className="absolute inset-x-3 bottom-3 bg-white/95 py-1 text-center text-[9px] font-bold text-black">DEMO · NOT SCANNABLE</span></div>;
}

function MembershipContent() {
  const manifest = useCapabilities();
  const officer = manifest.portal.audience === "officer";
  const pending = useSearchParams().get("demo") === "pending";
  const query = useQuery({ queryKey: ["membership-status", pending], queryFn: () => fetchJson<MembershipStatus>(`/api/membership/status${pending ? "?demo=pending" : ""}`, { cache: "no-store" }) });
  const status = query.data;
  const applicants = [
    { handle: "Applicant_18C2", state: "payment proof review", age: "4 min" },
    { handle: "Member_7D91", state: "email confirmed", age: "18 min" },
  ];
  return <div className="space-y-5"><section className="rounded-2xl border border-accent/30 bg-[linear-gradient(135deg,rgb(var(--accent-rgb)/.1),rgb(var(--surface-rgb)))] p-6 lg:p-8"><Badge variant="orange">Membership access gate</Badge><h1 className="mt-4 text-3xl font-extrabold">{officer ? "Upcoming member review" : status?.paid ? "Membership active" : "Complete membership verification"}</h1><p className="mt-3 max-w-2xl leading-7 text-muted">Authentication creates an identity. Paid membership and officer verification separately authorize community access.</p></section>
    {officer ? <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><Card className="bg-surface"><h2 className="font-bold">Review queue</h2><div className="mt-4 space-y-2">{applicants.map((item) => <div className="flex items-center justify-between rounded-lg border border-border p-4" key={item.handle}><div><p className="font-semibold">{item.handle}</p><p className="mt-1 text-xs text-muted">{item.state} · {item.age}</p></div><Badge variant="warning">Human review</Badge></div>)}</div></Card><Card className="bg-surface"><ShieldCheck className="text-success" /><h2 className="mt-4 font-bold">Officer verification boundary</h2><p className="mt-2 text-sm leading-6 text-muted">Payment proof must be checked manually. The demo never auto-approves, charges, or stores financial credentials.</p></Card></section> : <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><Card className="flex items-center justify-center bg-surface"><DemoQr /></Card><Card className="bg-surface"><div className="flex items-center gap-3">{status?.paid ? <CheckCircle2 className="text-success" /> : <Clock3 className="text-warning" />}<div><h2 className="font-bold capitalize">{status?.state.replaceAll("_", " ") || "Checking status"}</h2><p className="mt-1 text-sm text-muted">Reference: {status?.paymentReference || "—"}</p></div></div><div className="mt-6 space-y-3">{["Sign in with a verified school or Google identity","Submit payment using the officer-configured channel","Wait for a human officer to verify and activate access"].map((step,index) => <div className="flex gap-3 rounded-lg border border-border p-3" key={step}><span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-accentSoft font-mono text-accent">{index+1}</span><span className="text-sm">{step}</span></div>)}</div><div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-5 text-muted"><QrCode className="mb-2 text-warning" size={18} />This development QR is intentionally non-scannable. Production payment destinations must be configured and reviewed by authorized officers.</div></Card></section>}
    <Card className="bg-surface"><div className="flex gap-3"><UserCheck className="text-accent" /><div><h2 className="font-bold">Why sign-ins that do not convert are retained</h2><p className="mt-2 text-sm leading-6 text-muted">The system records a minimal funnel event—provider, membership state, and timestamp—to improve onboarding. It does not expose the Google account to other members, and retention must be time-bounded.</p></div></div></Card>
  </div>;
}

export default function MembershipPage() {
  return <AppShell><Suspense fallback={<Card className="bg-surface text-sm text-muted">Loading membership status…</Card>}><MembershipContent /></Suspense></AppShell>;
}
