"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { EvidenceClaim, EvidenceReview, OfficerEvidenceAppeal } from "@pytorch-ph/domain-protocol/organization";
import { departmentLabel } from "../../events/event-labels";

// Officers verify the evidence that earns points, one claim at a time, and resolve appeals.
function EvidenceReviewContent() {
  const client = useQueryClient();
  const [claimIndex, setClaimIndex] = useState(0);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewLevel, setReviewLevel] = useState<EvidenceReview["level"]>("contributor");
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});
  const claims = useQuery({ queryKey: ["evidence-review"], queryFn: () => fetchJson<EvidenceClaim[]>("/api/officer/evidence", { cache: "no-store" }) });
  const appeals = useQuery({ queryKey: ["evidence-appeals"], queryFn: () => fetchJson<OfficerEvidenceAppeal[]>("/api/officer/evidence/appeals", { cache: "no-store" }) });

  const review = useMutation({
    mutationFn: ({ id, value }: { id: string; value: EvidenceReview }) => fetchJson(`/api/officer/evidence/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: async () => { setReviewReason(""); await client.invalidateQueries({ queryKey: ["evidence-review"] }); toast.success("Exact claim revision reviewed."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Review failed."),
  });

  const resolveAppeal = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "restore" | "uphold" }) => fetchJson(`/api/officer/evidence/appeals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: appealReasons[id] || "" }) }),
    onSuccess: async (_, variables) => { setAppealReasons((current) => ({ ...current, [variables.id]: "" })); await client.invalidateQueries({ queryKey: ["evidence-appeals"] }); toast.success("Appeal resolved with an attributable decision."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Appeal resolution failed."),
  });

  const pendingClaims = (claims.data || []).filter((claim) => ["manual_pending", "scraped_pending", "disputed"].includes(claim.provenance));
  const activeClaim = pendingClaims[Math.min(claimIndex, Math.max(0, pendingClaims.length - 1))];
  const activeClaimIsExtension = activeClaim?.origin === "extension_scrape" || (!activeClaim?.origin && activeClaim?.source !== "manual");

  return <div className="space-y-5">
    <section className="border border-border bg-surface p-6 lg:p-8">
      <Badge variant="orange">Officers only</Badge>
      <h1 className="mt-3 text-3xl font-extrabold">Evidence review</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted">Verify the evidence that earns points. Only verified evidence counts toward a member's tier on the leaderboards.</p>
    </section>

    <Card className="bg-surface"><div className="flex items-center gap-3"><ShieldAlert className="text-warning"/><div><h2 className="font-bold">Evidence integrity flash cards</h2><p className="text-sm text-muted">Review one immutable claim at a time. An anomaly is not proof of intent.</p></div></div>{activeClaim ? <article className="mt-5 rounded-xl border border-border bg-elevated p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><Badge variant="orange">{activeClaimIsExtension ? "Scraped" : "Manual"}</Badge><Badge>{activeClaim.provenance.replaceAll("_", " ")}</Badge></div><h3 className="mt-3 text-xl font-bold">{activeClaim.title}</h3><p className="mt-2 text-xs text-muted">{activeClaim.memberLabel} · {activeClaim.source} · {departmentLabel(activeClaim.department)} · {activeClaim.contentHash}</p></div><span className="text-xs text-muted">{claimIndex + 1} / {pendingClaims.length}</span></div>{activeClaim.sourceUrl && <a className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent" href={activeClaim.sourceUrl} rel="noreferrer" target="_blank">Open submitted source <ExternalLink size={14}/></a>}<pre className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-xs text-muted">{JSON.stringify(activeClaim.normalizedPayload || {}, null, 2)}</pre>{Boolean(activeClaim.riskSignals?.length) && <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">Officer-only signals: {activeClaim.riskSignals?.join(", ")}</div>}<div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Verified level<select className="mt-1 w-full rounded-lg border border-border bg-surface p-2" onChange={(event) => setReviewLevel(event.target.value as EvidenceReview["level"])} value={reviewLevel}><option value="participation">Participation</option><option value="contributor">Completion / contributor</option><option value="finalist_lead">Finalist / lead</option><option value="winner_top_award">Winner / top award</option></select></label><label className="text-sm">Decision reason<textarea className="mt-1 min-h-20 w-full rounded-lg border border-border bg-surface p-2" maxLength={1200} onChange={(event) => setReviewReason(event.target.value)} placeholder="Required for non-approval decisions" value={reviewReason}/></label></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={review.isPending} onClick={() => review.mutate({ id: activeClaim.id, value: { decision: "approve", level: reviewLevel, reason: reviewReason } })}>Approve exact claim</Button>{activeClaimIsExtension && <Button disabled={reviewReason.trim().length < 4 || review.isPending} onClick={() => review.mutate({ id: activeClaim.id, value: { decision: "scraper_defect", reason: reviewReason } })} variant="secondary">Scraper defect</Button>}<Button disabled={reviewReason.trim().length < 4 || review.isPending} onClick={() => review.mutate({ id: activeClaim.id, value: { decision: "reject_unsupported", reason: reviewReason } })} variant="secondary">Unsupported</Button><Button disabled={reviewReason.trim().length < 4 || review.isPending} onClick={() => review.mutate({ id: activeClaim.id, value: { decision: activeClaimIsExtension ? "confirm_tampering" : "confirm_falsification", reason: reviewReason } })} variant="secondary">Confirm violation</Button></div><div className="mt-4 flex justify-between"><Button disabled={claimIndex === 0} onClick={() => setClaimIndex((value) => Math.max(0, value - 1))} size="sm" variant="outline">Previous</Button><Button disabled={claimIndex >= pendingClaims.length - 1} onClick={() => setClaimIndex((value) => Math.min(pendingClaims.length - 1, value + 1))} size="sm" variant="outline">Next</Button></div></article> : <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">No pending evidence claims.</p>}</Card>

    {Boolean(appeals.data?.length) && <Card className="bg-surface"><h2 className="font-bold">Open evidence appeals</h2><p className="mt-1 text-sm text-muted">Restore or uphold eligibility from the submitted record. Every resolution requires a reason.</p><div className="mt-4 space-y-3">{appeals.data?.map((appeal) => <article className="rounded-xl border border-border bg-elevated p-4" key={appeal.id}><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{appeal.memberLabel} · {appeal.violationType.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-muted">{appeal.note}</p></div><Badge variant="warning">open</Badge></div><textarea className="mt-3 min-h-20 w-full rounded-lg border border-border bg-surface p-2 text-sm" maxLength={1200} onChange={(event) => setAppealReasons((current) => ({ ...current, [appeal.id]: event.target.value }))} placeholder="Required resolution reason" value={appealReasons[appeal.id] || ""}/><div className="mt-3 flex gap-2"><Button disabled={(appealReasons[appeal.id] || "").trim().length < 4 || resolveAppeal.isPending} onClick={() => resolveAppeal.mutate({ id: appeal.id, decision: "restore" })}>Restore eligibility</Button><Button disabled={(appealReasons[appeal.id] || "").trim().length < 4 || resolveAppeal.isPending} onClick={() => resolveAppeal.mutate({ id: appeal.id, decision: "uphold" })} variant="secondary">Uphold decision</Button></div></article>)}</div></Card>}
    {!claims.isLoading && pendingClaims.length === 0 && !appeals.data?.length && <Card className="bg-surface"><p className="text-sm text-muted">Nothing is waiting for review.</p></Card>}
  </div>;
}

export default function EvidenceReviewPage() {
  return <AppShell><EvidenceReviewContent /></AppShell>;
}
