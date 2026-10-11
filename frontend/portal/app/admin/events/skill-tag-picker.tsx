"use client";

import { useState, type KeyboardEvent } from "react";
import { Combobox } from "@pytorch-ph/design-system/combobox";
import { Label } from "@pytorch-ph/design-system/input";

type Skill = { slug: string; label: string };

export function allocateSkillTags(selected: string[]) {
  if (!selected.length) return [];
  const share = Math.floor(10000 / selected.length);
  return selected.map((skillSlug, index) => ({
    skillSlug,
    allocationBps: index === selected.length - 1 ? 10000 - share * index : share,
  }));
}

export function SkillTagPicker({ skills, selected, onChange }: {
  skills: Skill[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const available = skills.filter((skill) =>
    !selected.includes(skill.slug) && skill.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const allocations = allocateSkillTags(selected);
  const remove = (slug: string) => onChange(selected.filter((item) => item !== slug));
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Backspace" && !query && event.target instanceof HTMLInputElement && selected.length) {
      remove(selected[selected.length - 1]);
    }
  };
  return <div onKeyDown={handleKey}>
    <Label htmlFor="event-skills">Skill tags</Label>
    <Combobox id="event-skills" label="Search skill tags" onQueryChange={setQuery}
      onSelect={(option) => { if (!selected.includes(option.value)) onChange([...selected, option.value]); setQuery(""); }}
      openOnEmpty options={available.map((skill) => ({ value: skill.slug, label: skill.label }))}
      placeholder="Search and add a skill" query={query} />
    <div aria-label="Selected skill tags" className="mt-2 flex max-h-32 flex-wrap content-start gap-2 overflow-y-auto overscroll-contain rounded-lg border border-border p-2">
      {allocations.map(({ skillSlug, allocationBps }) => {
        const label = skills.find((skill) => skill.slug === skillSlug)?.label ?? skillSlug;
        return <span className="inline-flex items-center gap-2 border border-border bg-elevated px-2 py-1 text-sm" key={skillSlug}>
          {label} · {(allocationBps / 100).toFixed(2)}%
          <button aria-label={`Remove ${label}`} className="focus-ring font-semibold text-accent" onClick={() => remove(skillSlug)} type="button">×</button>
        </span>;
      })}
    </div>
    <p className="mt-2 text-xs text-muted" role="status">Allocation total: {selected.length ? "100%" : "0%"}. Points are split evenly across selected skills. Backspace removes the last tag.</p>
  </div>;
}
