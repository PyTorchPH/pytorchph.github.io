"use client";

// Officer "Member demographics" section for the Command Center.
// Module map:
//   MemberDemographics   loads GET /api/officer/demographics; headline counts + one bar list per breakdown
//   ├─ CountTile         respondents / consented number
//   └─ BreakdownBars     horizontal bars for one breakdown (server already merged groups under 5)
//   BREAKDOWN_TITLES     display order and titles

import { useQuery } from "@tanstack/react-query";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import type { DemographicBreakdown, DemographicCount } from "@pytorch-ph/domain-protocol/identity";
import { DEMOGRAPHICS_QUERY_KEY, fetchDemographics } from "../api";

const BREAKDOWN_TITLES: [DemographicBreakdown, string][] = [
  ["status", "Status"], ["ageRange", "Age range"], ["gender", "Gender"], ["region", "Region"], ["school", "School"],
  ["company", "Company"], ["industry", "Industry"], ["interest", "Interests"], ["channel", "Found us through"],
];

// Mental model: this view never sees individuals; it renders whatever aggregate the server returns.
export function MemberDemographics() {
  const { data, isError, isLoading } = useQuery({ queryKey: DEMOGRAPHICS_QUERY_KEY, queryFn: fetchDemographics, retry: false });
  return <Card className="border-border">
    <CardHeader><div>
      <div className="flex items-center gap-2">
        <CardTitle>Member demographics</CardTitle>
        <InfoPopover label="About these numbers" title="About these numbers">
          <p className="text-sm leading-6">Counts only include members who consented. Groups smaller than {data?.minimumGroupSize ?? 5} are merged into “Other”.</p>
        </InfoPopover>
      </div>
      <CardDescription>Aggregated profile answers from consenting members.</CardDescription>
    </div></CardHeader>
    <div>
      {isLoading && <p className="text-sm text-muted">Loading demographics…</p>}
      {isError && <p className="text-sm text-muted">Demographics are unavailable right now.</p>}
      {data && <>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
          <CountTile label="Respondents" value={data.respondents} />
          <CountTile label="Consented" value={data.consented} />
        </div>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {BREAKDOWN_TITLES.map(([key, title]) => <BreakdownBars counts={data.breakdowns[key] ?? []} key={key} title={title} />)}
        </div>
      </>}
    </div>
  </Card>;
}

function CountTile({ label, value }: { label: string; value: number }) {
  return <div className="bg-elevated p-3">
    <p className="data-label text-[11px] uppercase text-muted">{label}</p>
    <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
  </div>;
}

function BreakdownBars({ title, counts }: { title: string; counts: DemographicCount[] }) {
  const largest = Math.max(1, ...counts.map((row) => row.count));
  return <div>
    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
    {!counts.length && <p className="text-xs text-muted">No data yet.</p>}
    <ul className="space-y-1.5">
      {counts.map((row) => <li className="text-xs" key={row.label}>
        <div className="flex justify-between gap-2"><span className="truncate">{row.label}</span><span className="text-muted">{row.count}</span></div>
        <div className="mt-0.5 h-1.5 bg-elevated"><div className="h-full bg-accent" style={{ width: `${(row.count / largest) * 100}%` }} /></div>
      </li>)}
    </ul>
  </div>;
}
