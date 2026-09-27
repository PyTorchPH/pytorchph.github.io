"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Sparkles, Trophy } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { PersonalActivityChart, SkillPointsChart } from "@pytorch-ph/domain-client/organization";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";
import { Progress } from "@pytorch-ph/design-system/progress";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { rankForPoints, summarizePeers, type LeaderboardPayload, type MemberOverview } from "@pytorch-ph/domain-protocol/leaderboards";
import { RankingGuide } from "./explain-ranking";
import { PeerScorecard } from "./render-peer-scorecard";

const PEER_PAGE = "/api/member/leaderboard?page=1&pageSize=25&view=both";

export function MemberDashboard() {
  const overview = useQuery({ queryKey: ["member-overview"], queryFn: () => fetchJson<MemberOverview>("/api/member/overview", { cache: "no-store" }) });
  const ladder = useQuery({ queryKey: ["member-leaderboard", "", "", "both", 1], queryFn: () => fetchJson<LeaderboardPayload>(PEER_PAGE, { cache: "no-store" }) });
  const data = overview.data;
  const peers = ladder.data ? summarizePeers(ladder.data.entries, ladder.data.total) : null;
  const tier = data ? rankForPoints(data.summary.points) : null;
  const progress = tier && data ? (tier.ceiling ? ((data.summary.points - tier.floor) / (tier.ceiling - tier.floor)) * 100 : 100) : 0;
  const rank = peers?.rank ?? data?.summary.rank ?? null;

  return <AppShell><div className="space-y-6">
    <section className="border border-border bg-surface p-5 lg:p-7" data-testid="member-dashboard" data-tour="member-overview">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <FilipinoPhrase meaning="Welcome back, builder." phrase="Mabuhay!" />
          <h1 className="mt-1 text-3xl font-extrabold tracking-[-0.02em]">My performance</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">Your season standing, how you compare with your peers, and what to work on next.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-tour="member-ranking-guide">
          <RankingGuide />
          <Badge variant={overview.isError ? "warning" : data?.meta.mode === "local_demo" ? "warning" : "success"}>{overview.isError ? "Live data unavailable" : data?.meta.label || "Loading"}</Badge>
        </div>
      </div>
    </section>

    {overview.isError ? <Card className="bg-surface p-8 text-center"><h2 className="font-bold">Performance data unavailable</h2><p className="mt-2 text-sm text-muted">No synthetic values are substituted in live mode.</p></Card> : <>
      <section aria-labelledby="standing-heading" className="space-y-4" data-tour="member-standing">
        <h2 className="font-heading text-xl font-semibold" id="standing-heading">Standing against peers</h2>
        <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <Card className="bg-surface">
            <div className="flex items-center justify-between"><p className="text-sm text-muted">Season rank</p><Trophy aria-hidden="true" className="text-accent" size={24} /></div>
            <p className="mt-2 font-mono text-5xl font-bold">{rank ? `#${rank}` : "—"}<span className="ml-2 text-base font-normal text-muted">{peers ? `of ${peers.total}` : ""}</span></p>
            <p className="mt-2 text-sm font-semibold">{tier ? `${tier.tier} ${tier.division}` : "Unranked"}{peers ? ` · Top ${peers.topPercent}%` : ""}</p>
            <div className="mt-5 flex items-end justify-between"><p className="font-mono text-2xl font-bold">{data?.summary.points.toLocaleString() ?? "—"}<span className="ml-1 text-sm font-normal text-muted">verified points</span></p><p className="flex items-center gap-1 text-sm text-muted"><Flame aria-hidden="true" className="text-warning" size={16} />{data?.summary.streak ?? 0} week streak</p></div>
            <Progress className="mt-3" value={progress} />
            <p className="mt-2 text-xs text-muted">{tier?.ceiling && data ? `${tier.ceiling - data.summary.points} verified points to the next division` : tier ? "Top division reached" : ""}</p>
            <Link className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent underline underline-offset-2" href="/leaderboards">See the full leaderboard <ArrowRight aria-hidden="true" size={14} /></Link>
          </Card>
          <Card className="bg-surface">
            {peers ? <PeerScorecard summary={peers} /> : <p className="text-sm text-muted">{ladder.isError ? "Peer comparison is unavailable right now." : ladder.isLoading ? "Loading peer comparison…" : "Earn your first verified points to appear on the ladder and compare with your peers."}</p>}
          </Card>
        </div>
      </section>

      <section aria-labelledby="development-heading" className="space-y-4" data-tour="member-development">
        <h2 className="font-heading text-xl font-semibold" id="development-heading">Personal development</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bg-surface"><h3 className="font-bold">12-week verified activity</h3><p className="mt-1 text-sm text-muted">Only your weighted point events.</p><PersonalActivityChart data={data?.activity || []} /></Card>
          <Card className="bg-surface"><h3 className="font-bold">Verified skill points</h3><p className="mt-1 text-sm text-muted">Approved taxonomy links from verified point events.</p><SkillPointsChart data={data?.skillPoints || []} /></Card>
          <Card className="bg-surface"><h3 className="font-bold">Readiness checklist</h3><p className="mt-1 text-sm text-muted">Readiness is evidence-based; unknowns remain open.</p><ul className="mt-5 space-y-3">{data?.prerequisites.map((item) => <li className="flex items-center justify-between border border-border p-3" key={item.label}><span>{item.label}</span><Badge variant={item.ready ? "success" : "warning"}>{item.ready ? "Ready" : "Needs evidence"}</Badge></li>)}</ul></Card>
          <Card className="bg-surface"><div className="flex items-center gap-2"><Sparkles aria-hidden="true" className="text-accent" /><h3 className="font-bold">Recommended next moves</h3></div><ul className="mt-5 space-y-3">{data?.recommendations.map((item) => <li className="border border-border p-3 text-sm leading-6" key={item}>{item}</li>)}</ul></Card>
        </div>
      </section>
    </>}
  </div></AppShell>;
}
