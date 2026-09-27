"use client";

import { AtSign, Facebook, Linkedin, Medal, Plug, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { SkillBarChart, SkillRadarChart } from "@pytorch-ph/domain-client/organization";
import { GatePanel, IdentityCodes } from "@pytorch-ph/domain-client/identity";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Button } from "@pytorch-ph/design-system/button";
import { SegmentedTabs } from "@pytorch-ph/design-system/tabs";
import { userTiers, type UserTier } from "@pytorch-ph/domain-protocol/identity";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { LeaderboardIdentitySettings } from "@pytorch-ph/domain-protocol/leaderboards";
import type { MemberPrivacySettings, MembershipStatus } from "@pytorch-ph/domain-protocol/privacy-feedback";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { toast } from "sonner";

type UpskillPlan = { summary: string; recommendations: Array<{ focusSkill: string; rationale: string; nextStep: string; evidenceIds: string[] }>; warnings: string[] };

const tierTabs = [
  { value: "active", label: "Active" },
  { value: "leaderboard", label: "Elite" },
  { value: "general", label: "General" }
] satisfies Array<{ value: UserTier; label: string }>;

function ProfileContent() {
  const [tier, setTier] = useState<UserTier>("active");
  const manifest = useCapabilities();
  const officerPortal = manifest.portal.audience === "officer";
  const effectiveTier = officerPortal ? tier : manifest.portal.userTier;
  const privacy = useQuery({ queryKey: ["member-privacy"], queryFn: () => fetchJson<MemberPrivacySettings>("/api/member/privacy", { cache: "no-store" }) });
  const identity = useQuery({ queryKey: ["leaderboard-identity"], queryFn: () => fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { cache: "no-store" }) });
  const evidence = useQuery({ queryKey: ["product", "career-evidence"], queryFn: () => fetchJson<ProductViewData>("/api/product/career-evidence", { cache: "no-store" }) });
  const membership = useQuery({ queryKey: ["membership-status", false], queryFn: () => fetchJson<MembershipStatus>("/api/membership/status", { cache: "no-store" }) });
  const aiStatus = useQuery({ queryKey: ["local-ai-status"], queryFn: () => fetchJson<{ configured: boolean }>("/api/backend/local-ai/status", { cache: "no-store" }) });
  const [upskillPlan, setUpskillPlan] = useState<UpskillPlan | null>(null);
  const upskill = useMutation({
    mutationFn: () => {
      const verified = (evidence.data?.evidence?.items || []).filter((item) => item.verificationState === "source_matched" || item.verificationState === "user_verified");
      if (!verified.length) throw new Error("No verified evidence is available for UpSkill planning.");
      return fetchJson<UpskillPlan>("/api/backend/local-ai/upskill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidence: verified.map((item) => ({ id: item.id, title: item.title, description: item.description, skills: item.skills })) }) });
    },
    onSuccess: setUpskillPlan,
    onError: (error) => toast.error(error instanceof Error ? error.message : "UpSkill planning failed."),
  });
  const identityLinks = (evidence.data?.evidence?.sources || []).flatMap((source) => source.connectionStatus === "connected" && source.configuredUrl?.startsWith("https://") ? [{ id: source.id, label: source.label, url: source.configuredUrl }] : []);
  const memberLabel = privacy.data?.hideRealName !== false ? identity.data?.preview || "Member #7A82F" : "Mika Santos";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.02em]">My profile</h1>
          <p className="mt-2 text-muted">Your identity, QR codes, connected accounts, and skills.</p>
        </div>
        {officerPortal ? <SegmentedTabs items={tierTabs} onChange={setTier} value={tier} /> : <Badge variant="orange">{userTiers[effectiveTier].label}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
        <Card className="bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-accent text-white">
                <UserRound size={30} />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-[-0.02em]">{officerPortal ? "Mika Santos · Alex_Rivera" : memberLabel}</h2>
                <p className="text-sm text-muted">PyTorch Philippines member · {membership.data?.state === "active" ? "Membership active (free)" : "Membership under review"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="orange">Computer Vision</Badge>
                  <Badge variant="success">AI Study Circles</Badge>
                  <Badge>2026 member</Badge>
                </div>
              </div>
            </div>
            <Badge variant="orange">{userTiers[effectiveTier].label}</Badge>
          </div>
        </Card>

        <Card className="bg-elevated">
          <CardHeader>
            <div>
              <CardTitle>Social connectors</CardTitle>
              <CardDescription>Client-side parsing only; raw text stays private until reviewed.</CardDescription>
            </div>
            <Plug className="text-accent" size={20} />
          </CardHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <button className="focus-ring flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-all duration-300 ease-in-out hover:bg-elevated" type="button">
              <span className="flex items-center gap-2 font-semibold"><AtSign size={18} /> Google</span>
              <Badge variant={privacy.data?.hideGoogleIdentity === false ? "success" : "warning"}>{officerPortal || privacy.data?.hideGoogleIdentity === false ? "Connected" : "Hidden"}</Badge>
            </button>
            <button className="focus-ring flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-all duration-300 ease-in-out hover:bg-elevated" type="button">
              <span className="flex items-center gap-2 font-semibold"><Linkedin size={18} /> LinkedIn</span>
              <Badge variant="success">Linked</Badge>
            </button>
            <button className="focus-ring flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-all duration-300 ease-in-out hover:bg-elevated" type="button">
              <span className="flex items-center gap-2 font-semibold"><Facebook size={18} /> Facebook</span>
              <Badge>Ready</Badge>
            </button>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <IdentityCodes links={identityLinks} username={identity.data?.username || ""} />
      </div>

      <div className="mt-4">
        <GatePanel tier={effectiveTier} />
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
            {!aiStatus.data?.configured && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">AI setup is required in Settings before UpSkill can run.</p>}
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
