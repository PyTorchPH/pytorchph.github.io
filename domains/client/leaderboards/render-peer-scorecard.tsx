"use client";

import type { PeerSummary } from "@pytorch-ph/domain-protocol/leaderboards";

const share = (value: number, leader: number) => (leader > 0 ? Math.round((value / leader) * 100) : 0);

// A stat line like a team sheet: your numbers beside the peer median and the current leader.
export function PeerScorecard({ summary }: { summary: PeerSummary }) {
  const scope = summary.total > summary.comparedWith ? `the top ${summary.comparedWith} of ${summary.total} members` : `all ${summary.total} ranked members`;
  return (
    // Positioned so visually hidden text inside the table is clipped with it; focusable so keyboards can scroll it.
    <div aria-label="Comparison with peers" className="relative overflow-x-auto" role="region" tabIndex={0}>
      <table className="w-full min-w-[30rem] text-left text-sm">
        <caption className="mb-3 text-left text-sm text-muted">Compared with {scope} this season.</caption>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-semibold" scope="col">Stat</th>
            <th className="py-2 pr-3 font-semibold" scope="col">You</th>
            <th className="py-2 pr-3 font-semibold" scope="col">Peer median</th>
            <th className="py-2 pr-3 font-semibold" scope="col">Leader</th>
            <th className="py-2 font-semibold" scope="col">You vs. leader</th>
          </tr>
        </thead>
        <tbody>
          {summary.metrics.map((metric) => {
            const difference = metric.you - metric.median;
            return (
              <tr className="border-b border-border last:border-0" key={metric.key}>
                <th className="py-3 pr-3 font-semibold" scope="row">{metric.label}</th>
                <td className="py-3 pr-3 font-mono text-base font-bold">{metric.you.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mono">
                  {metric.median.toLocaleString()}
                  <span className={difference >= 0 ? "ml-2 text-xs text-success" : "ml-2 text-xs text-danger"}>{difference >= 0 ? "+" : "−"}{Math.abs(difference).toLocaleString()}</span>
                </td>
                <td className="py-3 pr-3 font-mono">{metric.leader.toLocaleString()}</td>
                <td className="py-3">
                  <div aria-hidden="true" className="relative h-2 w-full min-w-24 bg-elevated">
                    <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${share(metric.you, metric.leader)}%` }} />
                    <div className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${share(metric.median, metric.leader)}%` }} />
                  </div>
                  <span className="sr-only">{share(metric.you, metric.leader)}% of the leader</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">Orange bar: you. Dark marker: peer median. A full bar matches the leader.</p>
    </div>
  );
}
