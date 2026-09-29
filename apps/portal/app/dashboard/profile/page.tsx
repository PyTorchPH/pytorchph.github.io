"use client";

import { Facebook, Github, Linkedin, Medal, Plug, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { SkillBarChart, SkillRadarChart } from "@pytorch-ph/domain-client/organization";
import { IdentityCodes } from "@pytorch-ph/domain-client/identity";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { LeaderboardIdentitySettings } from "@pytorch-ph/domain-protocol/leaderboards";
import type { MembershipStatus } from "@pytorch-ph/domain-protocol/privacy-feedback";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { toast } from "sonner";
import { aiComplete, aiStatus as localAIStatus } from "@pytorch-ph/domain-client/client-automation";

type VerifiedAccount = { provider: "github" | "linkedin" | "facebook"; handle: string; profileUrl: string };
const PROVIDER_ICONS = { github: { icon: Github, label: "GitHub" }, linkedin: { icon: Linkedin, label: "LinkedIn" }, facebook: { icon: Facebook, label: "Facebook" } } as const;

type UpskillPlan = { summary: string; recommendations: Array<{ focusSkill: string; rationale: string; nextStep: string; evidenceIds: string[] }>; warnings: string[] };

function parseUpskillPlan(reply: string): UpskillPlan {
  const text = reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const value = JSON.parse(text) as Partial<UpskillPlan>;
  if (typeof value.summary !== "string" || !Array.isArray(value.recommendations)) throw new Error("The AI reply was not a valid plan. Try again.");
  const strings = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
  return {
    summary: value.summary,
    recommendations: value.recommendations.slice(0, 6).map((item) => ({ focusSkill: String(item?.focusSkill ?? ""), rationale: String(item?.rationale ?? ""), nextStep: String(item?.nextStep ?? ""), evidenceIds: strings(item?.evidenceIds) })),
    warnings: strings(value.warnings),
  };
}

function ProfileContent() {
  // Only accounts verified through the extension count as connected.
  const accounts = useQuery({ queryKey: ["member-accounts"], queryFn: () => fetchJson<VerifiedAccount[]>("/api/member/accounts", { cache: "no-store" }) });
  const identity = useQuery({ queryKey: ["leaderboard-identity"], queryFn: () => fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { cache: "no-store" }) });
  const evidence = useQuery({ queryKey: ["product", "career-evidence"], queryFn: () => fetchJson<ProductViewData>("/api/product/career-evidence", { cache: "no-store" }) });
  const membership = useQuery({ queryKey: ["membership-status", false], queryFn: () => fetchJson<MembershipStatus>("/api/membership/status", { cache: "no-store" }) });
  const aiStatus = useQuery({ queryKey: ["local-ai-status"], queryFn: localAIStatus });
  const [upskillPlan, setUpskillPlan] = useState<UpskillPlan | null>(null);
  const upskill = useMutation({
    mutationFn: async () => {
      const verified = (evidence.data?.evidence?.items || []).filter((item) => item.verificationState === "source_matched" || item.verificationState === "user_verified");
      if (!verified.length) throw new Error("No verified evidence is available for UpSkill planning.");
      const cited = verified.map((item) => ({ id: item.id, title: item.title, description: item.description, skills: item.skills }));
      // The member's own AI provider, called by their extension; nothing goes through our server.
      const reply = await aiComplete({
        system: "You are a career coach for a PyTorch community member. Use only the evidence provided and cite evidence ids. Answer with JSON only.",
        prompt: `Evidence:
${JSON.stringify(cited)}

Return {"summary": string, "recommendations": [{"focusSkill": string, "rationale": string, "nextStep": string, "evidenceIds": string[]}], "warnings": string[]} with 2-4 recommendations.`,
        json: true,
        maxTokens: 1200,
      });
      return parseUpskillPlan(reply);
    },
    onSuccess: setUpskillPlan,
    onError: (error) => toast.error(error instanceof Error ? error.message : "UpSkill planning failed."),
  });
  const identityLinks = (accounts.data || []).map((account) => ({ id: account.provider, label: PROVIDER_ICONS[account.provider].label, url: account.profileUrl }));
  const memberLabel = identity.data?.preview || identity.data?.username || "Member";

  return (
    <>
      <div className="page-hero flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.02em]">My profile</h1>
          <p className="mt-2 text-muted">Your identity, QR codes, connected accounts, and skills.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
        <Card className="bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-accent text-white">
                <UserRound size={30} />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-[-0.02em]">{memberLabel}</h2>
                <p className="text-sm text-muted">PyTorch Philippines member · {membership.data?.state === "active" ? "Membership active (free)" : "Membership under review"}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-elevated">
          <CardHeader>
            <div>
              <CardTitle>Connected accounts</CardTitle>
              <CardDescription>Verified with the PyTorch PH extension.</CardDescription>
            </div>
            <Plug className="text-accent" size={20} />
          </CardHeader>
          {accounts.data?.length ? <ul aria-label="Verified accounts" className="flex flex-wrap gap-2">
            {accounts.data.map((account) => { const { icon: Icon, label } = PROVIDER_ICONS[account.provider]; return <li key={account.provider}><a aria-label={`${label}: ${account.handle}`} className="focus-ring flex h-11 w-11 items-center justify-center border border-border bg-surface text-ink hover:border-accent hover:text-accent" href={account.profileUrl} rel="noreferrer" target="_blank" title={`${label} · ${account.handle}`}><Icon aria-hidden="true" size={20} /></a></li>; })}
          </ul> : <p className="text-sm text-muted">{accounts.isLoading ? "Loading…" : <>No verified accounts yet. <Link className="font-semibold text-accent underline underline-offset-2" href="/settings#accounts">Verify one in Settings</Link>.</>}</p>}
        </Card>
      </div>

      <div className="mt-4">
        <IdentityCodes links={identityLinks} username={identity.data?.username || ""} />
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="bg-surface">
          <CardHeader>
            <div>
              <CardTitle>UpSkill radar</CardTitle>
              <CardDescription>Sub-field profile generated from verified community activity.</CardDescription>
            </div>
            <Medal className="text-accent" size={20} />
          </CardHeader>
          <SkillRadarChart />
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted">Generate evidence-cited next steps through your configured local AI boundary.</p><Button disabled={!aiStatus.data?.configured || upskill.isPending || evidence.isLoading} onClick={() => upskill.mutate()} size="sm" type="button"><Sparkles size={15} />{upskill.isPending ? "Planning…" : "Generate local AI plan"}</Button></div>
            {!aiStatus.data?.configured && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Connect an AI provider in Settings (stored in your extension) before UpSkill can run.</p>}
            {upskillPlan && <div className="space-y-3"><p className="text-sm leading-6">{upskillPlan.summary}</p>{upskillPlan.recommendations.map((item) => <div className="rounded-lg border border-border bg-elevated p-3" key={`${item.focusSkill}-${item.evidenceIds.join("-")}`}><p className="font-semibold">{item.focusSkill}</p><p className="mt-1 text-sm text-muted">{item.rationale}</p><p className="mt-2 text-sm"><span className="font-semibold">Next:</span> {item.nextStep}</p><p className="mt-2 font-mono text-xs text-muted">Evidence: {item.evidenceIds.join(", ")}</p></div>)}</div>}
          </div>
        </Card>
        <Card className="bg-surface">
          <CardHeader>
            <div>
              <CardTitle>Merit activity blocks</CardTitle>
              <CardDescription>Evidence categories behind personal recommendations.</CardDescription>
            </div>
          </CardHeader>
          <SkillBarChart />
        </Card>
      </section>
    </>
  );
}

export default function ProfilePage() {
  return <AppShell><ProfileContent /></AppShell>;
}
