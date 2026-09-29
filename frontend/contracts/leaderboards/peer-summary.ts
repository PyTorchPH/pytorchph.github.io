import type { LeaderboardEntry } from "./result-shape";

export type PeerMetric = { key: "points" | "verifiedPoints" | "streak" | "verifiedSkills"; label: string; you: number; median: number; leader: number };
export type PeerSummary = { comparedWith: number; total: number; rank: number; topPercent: number; metrics: PeerMetric[] };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// Compares the current member with the other listed members. `total` is the full ladder size, which
// can be larger than the listed page, so the rank and percentile always describe the whole ladder.
export function summarizePeers(entries: readonly LeaderboardEntry[], total: number): PeerSummary | null {
  const you = entries.find((entry) => entry.isCurrentUser);
  if (!you || entries.length < 2) return null;
  const metric = (key: PeerMetric["key"], label: string, read: (entry: LeaderboardEntry) => number): PeerMetric => {
    const values = entries.map(read);
    return { key, label, you: read(you), median: median(values), leader: Math.max(...values) };
  };
  const ladderSize = Math.max(total, entries.length);
  return {
    comparedWith: entries.length,
    total: ladderSize,
    rank: you.rank,
    topPercent: Math.min(100, Math.max(1, Math.ceil((you.rank / ladderSize) * 100))),
    metrics: [
      metric("points", "Season points", (entry) => entry.points),
      metric("verifiedPoints", "Verified points", (entry) => entry.verifiedPoints),
      metric("streak", "Active-week streak", (entry) => entry.streak),
      metric("verifiedSkills", "Verified skills", (entry) => entry.verifiedSkills.length),
    ],
  };
}
