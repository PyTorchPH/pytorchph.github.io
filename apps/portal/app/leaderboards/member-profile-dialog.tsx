"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, ExternalLink, Trophy } from "lucide-react";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Badge } from "@pytorch-ph/design-system/badge";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { LeaderboardProfile } from "@pytorch-ph/domain-protocol/leaderboards";

const levelLabel = (level: string | null) => level ? level.replaceAll("_", " ") : "verified";
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString() : "";

// Achievements of a member who shared them (or your own row), opened from the leaderboard.
export function MemberProfileDialog({ profileId, season, onClose }: { profileId: string; season: string; onClose: () => void }) {
  const params = new URLSearchParams({ id: profileId, ...(season ? { season } : {}) });
  const query = useQuery({
    queryKey: ["leaderboard-profile", profileId, season],
    queryFn: () => fetchJson<LeaderboardProfile>(`/api/member/leaderboard/profile?${params}`, { cache: "no-store" }),
  });
  const profile = query.data;
  const title = profile ? profile.standing.displayLabel : "Member achievements";
  const description = profile ? `#${profile.standing.rank} · ${profile.standing.tier} ${profile.standing.division} · ${profile.standing.verifiedPoints.toLocaleString()} verified points` : "Loading achievements…";
  return <AppDialog description={description} onClose={onClose} title={title}>
    <div className="space-y-5 p-5 sm:p-6">
      {query.isError && <p className="text-sm" role="alert">{query.error instanceof Error ? query.error.message : "Achievements are unavailable."}</p>}
      {profile && <>
        {profile.standing.verifiedSkills.length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-muted">Verified skills</h3><div className="flex flex-wrap gap-1">{profile.standing.verifiedSkills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</div></section>}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Award aria-hidden="true" size={15} /> Approved evidence</h3>
          {profile.evidence.length ? <ul className="divide-y divide-border border border-border">{profile.evidence.map((item, index) => <li className="flex items-start justify-between gap-3 p-3" key={`${item.title}-${index}`}>
            <div><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs capitalize text-muted">{item.kind.replaceAll("_", " ")} · {levelLabel(item.level)}{item.date ? ` · ${dateLabel(item.date)}` : ""}</p>
              {item.sourceUrl && <a className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent" href={item.sourceUrl} rel="noreferrer" target="_blank">Source <ExternalLink aria-hidden="true" size={12} /></a>}</div>
            <span className="font-mono text-sm">+{item.points}</span>
          </li>)}</ul> : <p className="text-sm text-muted">No officer-approved evidence yet.</p>}
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Trophy aria-hidden="true" size={15} /> Event placements</h3>
          {profile.placements.length ? <ul className="divide-y divide-border border border-border">{profile.placements.map((item, index) => <li className="flex items-center justify-between gap-3 p-3" key={`${item.event}-${index}`}>
            <div><p className="font-semibold">{item.event}</p><p className="mt-1 text-xs text-muted">{item.place ? `Place #${item.place} · ` : ""}{dateLabel(item.date)}</p></div>
            <span className="font-mono text-sm">+{item.points}</span>
          </li>)}</ul> : <p className="text-sm text-muted">No event points yet.</p>}
        </section>
      </>}
    </div>
  </AppDialog>;
}
