"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import type { EvidenceClaim } from "@pytorch-ph/domain-protocol/organization";

const PENDING_CLAIMS = ["manual_pending", "scraped_pending", "disputed"];
const CLOSED_EVENTS = ["sado_approved", "rejected"];

// The officer-only part of My Performance: work that is waiting for an officer, with a link to each tool.
export function OfficerDesk() {
  const officer = useCapabilities().portal.audience === "officer";
  const claims = useQuery({ enabled: officer, queryKey: ["evidence-review"], queryFn: () => fetchJson<EvidenceClaim[]>("/api/officer/evidence", { cache: "no-store" }) });
  const dashboard = useQuery({ enabled: officer, queryKey: queryKeys.product("dashboard"), queryFn: () => fetchJson<ProductViewData>("/api/product/dashboard", { cache: "no-store" }) });
  if (!officer) return null;

  const queues = [
    { label: "Evidence claims to review", href: "/admin/evidence", waiting: claims.data?.filter((claim) => PENDING_CLAIMS.includes(claim.provenance)).length },
    { label: "Approvals waiting for a person", href: "/admin/dashboard", waiting: dashboard.data?.analytics?.approvals.data.filter((item) => item.status === "waiting").length },
  ];

  return <section aria-labelledby="officer-desk-heading" className="space-y-4" data-tour="officer-desk">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-heading text-xl font-semibold" id="officer-desk-heading">Officer desk</h2><Badge variant="orange">Officers only</Badge></div>
    <Card className="min-w-0 bg-surface">
      <h3 className="font-bold">Waiting for you</h3>
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {queues.map((queue) => <li key={queue.href}>
          <Link className="focus-ring flex items-center justify-between gap-3 py-3 text-sm hover:text-accent" href={queue.href}>
            <span className="font-semibold">{queue.label}</span>
            <span className="flex items-center gap-3"><span className="font-mono text-base font-bold">{queue.waiting ?? "—"}</span><ArrowRight aria-hidden="true" size={15} /></span>
          </Link>
        </li>)}
      </ul>
      <p className="mt-4 text-sm text-muted">More officer tools are in the Officer tools section of the menu.</p>
    </Card>
  </section>;
}
