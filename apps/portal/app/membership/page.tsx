"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Card } from "@pytorch-ph/design-system/card";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { MembershipStatus } from "@pytorch-ph/domain-protocol/privacy-feedback";

const stateLabels: Record<MembershipStatus["state"], string> = {
  prospective: "Waiting for review",
  payment_pending: "Waiting for review",
  active: "Active",
  rejected: "Not approved",
};

// Membership is free. This page only reports the account status; the profile holds everything else.
function MembershipContent() {
  const query = useQuery({ queryKey: ["membership-status", false], queryFn: () => fetchJson<MembershipStatus>("/api/membership/status", { cache: "no-store" }) });
  const status = query.data;
  const active = status?.state === "active";
  return <div className="space-y-5">
    <section className="border border-border bg-surface p-6 lg:p-8">
      <h1 className="text-3xl font-extrabold">Membership</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted">Membership in PyTorch Philippines is free. There is nothing to pay and no payment code to scan.</p>
    </section>
    <Card className="bg-surface">
      <div className="flex items-center gap-3">
        {active ? <CheckCircle2 aria-hidden="true" className="text-success" /> : <Clock3 aria-hidden="true" className="text-warning" />}
        <div>
          <h2 className="font-bold">{query.isError ? "Status unavailable" : status ? stateLabels[status.state] : "Checking status"}</h2>
          <p className="mt-1 text-sm text-muted">{active ? "You have full access to the member portal." : "An organizer reviews new accounts before the member portal opens."}</p>
        </div>
      </div>
      {active && <Link className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent underline underline-offset-2" href="/dashboard/profile">Open my profile and QR codes <ArrowRight aria-hidden="true" size={14} /></Link>}
    </Card>
  </div>;
}

export default function MembershipPage() {
  return <AppShell><MembershipContent /></AppShell>;
}
