"use client";

// Community skill tally as slides: one table page in view at a time, most common skill first down
// to the most unique. Arrows slide the pages sideways; the number box jumps straight to a page.
// Module map (caller-first):
//   SkillTallySlides   loads GET /api/member/skill-tally and renders the slide deck
//   ├─ SlideTable      one page of rows (rank, skill, category, members)
//   └─ SlideControls   previous / next arrows and "Slide [n] of N" at the bottom right
//   pagesOf            rows → fixed-size pages

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { DataUnavailable } from "@pytorch-ph/design-system/data-unavailable";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

type TallyRow = { skill: string; category: string; members: number; share: number };
type SkillTally = { version: { publishedBy: string; publishedAt: string } | null; skills: TallyRow[]; membersWithSkills: number; unmappedRaw: number };

const ROWS_PER_SLIDE = 6;

export function SkillTallySlides() {
  const tally = useQuery({ queryKey: ["skill-tally"], queryFn: () => fetchJson<SkillTally>("/api/member/skill-tally", { cache: "no-store" }) });
  const pages = pagesOf(tally.data?.skills ?? [], ROWS_PER_SLIDE);
  const [slide, setSlide] = useState(0);
  const current = Math.min(slide, Math.max(pages.length - 1, 0));
  const empty = !tally.data?.skills.length;
  const stamp = tally.isError ? "Data unavailable" : tally.isLoading ? "Loading data" : tally.data?.version ? "No verified skills yet" : "Skill list not compiled yet";
  return <div className="flex h-72 flex-col">
    <DataUnavailable className="min-h-0 flex-1" label={stamp} unavailable={empty}>
      <div className="h-full overflow-hidden">
        <div className="flex h-full transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${current * 100}%)` }}>
          {(pages.length ? pages : [[]]).map((rows, index) => <SlideTable firstRank={index * ROWS_PER_SLIDE + 1} key={index} rows={rows} visible={index === current} />)}
        </div>
      </div>
    </DataUnavailable>
    <SlideControls count={Math.max(pages.length, 1)} current={current} onChange={setSlide} />
  </div>;
}

function SlideTable({ rows, firstRank, visible }: { rows: TallyRow[]; firstRank: number; visible: boolean }) {
  return <table aria-hidden={!visible} className="w-full shrink-0 basis-full text-sm">
    <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Skill</th><th className="py-2 pr-2">Category</th><th className="py-2 text-right">Members</th></tr></thead>
    <tbody>
      {rows.map((row, index) => <tr className="border-t border-border" key={row.skill}>
        <td className="py-2 pr-2 font-mono text-xs text-muted">{firstRank + index}</td>
        <td className="py-2 pr-2 font-semibold">{row.skill}</td>
        <td className="py-2 pr-2 text-muted">{row.category}</td>
        <td className="py-2 text-right font-mono">{row.members} <span className="text-xs text-muted">({row.share}%)</span></td>
      </tr>)}
    </tbody>
  </table>;
}

function SlideControls({ current, count, onChange }: { current: number; count: number; onChange: (slide: number) => void }) {
  const [draft, setDraft] = useState("");
  const go = (slide: number) => { onChange(Math.min(Math.max(slide, 0), count - 1)); setDraft(""); };
  return <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
    <button aria-label="Previous slide" className="focus-ring border border-border p-1 disabled:opacity-40" disabled={current === 0} onClick={() => go(current - 1)} type="button"><ChevronLeft size={16} /></button>
    <button aria-label="Next slide" className="focus-ring border border-border p-1 disabled:opacity-40" disabled={current >= count - 1} onClick={() => go(current + 1)} type="button"><ChevronRight size={16} /></button>
    <label className="flex items-center gap-1">Slide
      <input aria-label="Go to slide" className="w-12 border border-border bg-elevated px-1 py-0.5 text-center text-ink" max={count} min={1} onBlur={() => draft && go(Number(draft) - 1)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && draft) go(Number(draft) - 1); }} placeholder={String(current + 1)} type="number" value={draft} />
      of {count}
    </label>
  </div>;
}

export function pagesOf<T>(rows: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, page) => rows.slice(page * size, page * size + size));
}
