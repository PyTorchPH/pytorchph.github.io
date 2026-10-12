"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Combobox } from "@pytorch-ph/design-system/combobox";
import { aiComplete, aiStatus } from "@pytorch-ph/domain-client/client-automation";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

export type CatalogSkill = { slug: string; label: string; category: string; aliasCount: number };
type Catalog = { catalogVersion: number; skills: CatalogSkill[] };

export function useSkillCatalog() {
  return useQuery({ queryKey: ["skill-catalog"], queryFn: () => fetchJson<Catalog>("/api/member/skills/catalog", { cache: "no-store" }), staleTime: 60_000 });
}

export function SkillPicker({ selected, onChange, label = "Skills", allowAi = true }: {
  selected: string[]; onChange: (skills: string[]) => void; label?: string; allowAi?: boolean;
}) {
  const catalog = useSkillCatalog();
  const ai = useQuery({ queryKey: ["local-ai-status"], queryFn: aiStatus, enabled: allowAi });
  const [query, setQuery] = useState("");
  const [normalizing, setNormalizing] = useState(false);
  const options = useMemo(() => (catalog.data?.skills ?? [])
    .filter((skill) => !selected.some((item) => item.toLowerCase() === skill.label.toLowerCase()))
    .filter((skill) => `${skill.label} ${skill.category}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((skill) => ({ value: skill.label, label: `${skill.label} · ${skill.category}` })), [catalog.data, query, selected]);
  const add = (value: string) => {
    const clean = value.trim().replace(/\s+/g, " ").slice(0, 80);
    if (clean && !selected.some((item) => item.toLowerCase() === clean.toLowerCase())) onChange([...selected, clean]);
    setQuery("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && query.trim() && !options.length) { event.preventDefault(); add(query); }
    if (event.key === "Backspace" && !query && event.target instanceof HTMLInputElement) onChange(selected.slice(0, -1));
  };
  const normalize = async () => {
    if (!selected.length || !catalog.data?.skills.length) return;
    setNormalizing(true);
    try {
      const reply = await aiComplete({ json: true, maxTokens: 600,
        system: "Map submitted skill tags to a supplied catalog. Suggest only; never invent evidence. Return JSON only.",
        prompt: `Return {"skills":string[]} using a catalog label when semantically equivalent; otherwise keep the original tag.\nCatalog: ${JSON.stringify(catalog.data.skills.map(({ label, category }) => ({ label, category })))}\nTags: ${JSON.stringify(selected)}` });
      const parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { skills?: unknown };
      if (Array.isArray(parsed.skills)) onChange([...new Set(parsed.skills.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 50))]);
    } finally { setNormalizing(false); }
  };
  return <div onKeyDown={onKeyDown}>
    <div className="mb-1 flex items-center justify-between gap-2"><span className="text-sm font-medium">{label}</span>
      {allowAi && ai.data?.configured && <Button disabled={!selected.length || normalizing} onClick={() => void normalize()} size="sm" type="button" variant="ghost"><Sparkles size={14}/>{normalizing ? "Normalizing…" : "Normalize with my AI"}</Button>}
    </div>
    <Combobox id="shared-skill-picker" label={`Search ${label.toLowerCase()}`} onQueryChange={setQuery} onSelect={(option) => add(option.value)} openOnEmpty options={options} placeholder="Search skills or type Other and press Enter" query={query}/>
    <div aria-label={`Selected ${label.toLowerCase()}`} className="mt-2 flex min-h-11 flex-wrap gap-2 rounded-lg border border-border p-2">
      {selected.map((skill) => <Badge key={skill}>{skill}<button aria-label={`Remove ${skill}`} className="ml-2" onClick={() => onChange(selected.filter((item) => item !== skill))} type="button">×</button></Badge>)}
      {!selected.length && <span className="text-xs text-muted">No skills selected.</span>}
    </div>
    <p className="mt-1 text-xs text-muted">Unknown tags are saved for officer review. AI normalization is optional.</p>
  </div>;
}
