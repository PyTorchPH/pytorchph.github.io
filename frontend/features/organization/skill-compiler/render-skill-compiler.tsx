"use client";

// Command Center card for Technology officers: compile the community skill list with your own AI
// key (through the extension; the key never reaches our server), review it, then publish it.
// Module map (caller-first):
//   SkillCompiler     hidden unless the server says this officer may compile
//   ├─ compile        raw words → aiComplete (officer's key) → parseCompiledSkills
//   ├─ publish        POST /api/officer/skills/taxonomy
//   └─ CompiledPreview  skills with their merged raw words, plus words the AI left out

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { aiComplete, aiStatus } from "@pytorch-ph/domain-client/client-automation";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { compilePrompt, parseCompiledSkills, type CompileResult, type RawSkill } from "./compile";

type RawView = { canCompile: boolean; raw: RawSkill[] };
const COMPILE_MAX_TOKENS = 8000;

// Mental model: the server only hands out anonymous raw words; the officer's machine does the AI
// work; the server re-validates whatever is published.
export function SkillCompiler() {
  const raw = useQuery({ queryKey: ["officer-skills-raw"], queryFn: () => fetchJson<RawView>("/api/officer/skills/raw", { cache: "no-store" }) });
  const ai = useQuery({ queryKey: ["local-ai-status"], queryFn: aiStatus });
  const [result, setResult] = useState<CompileResult | null>(null);
  const queryClient = useQueryClient();
  const compile = useMutation({
    mutationFn: async () => {
      const words = raw.data?.raw ?? [];
      const reply = await aiComplete({ ...compilePrompt(words), json: true, maxTokens: COMPILE_MAX_TOKENS });
      return parseCompiledSkills(reply, words);
    },
    onSuccess: setResult,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Compiling failed."),
  });
  const publish = useMutation({
    mutationFn: () => fetchJson<{ skillCount: number }>("/api/officer/skills/taxonomy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skills: result?.skills ?? [], modelNote: "local AI via extension" }) }),
    onSuccess: async (saved) => { await queryClient.invalidateQueries({ queryKey: ["skill-tally"] }); toast.success(`Published ${saved.skillCount} normalized skills.`); setResult(null); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Publishing failed."),
  });
  if (!raw.data?.canCompile) return null;
  const words = raw.data.raw;
  return <Card className="bg-surface">
    <CardHeader><div><CardTitle>Skill compiler</CardTitle><CardDescription>Normalizes the skill words on members' verified achievements with your own AI key (in your extension). Only the words and counts are sent to your AI, never names.</CardDescription></div><Badge>{words.length} raw words</Badge></CardHeader>
    {!ai.data?.configured && <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Connect an AI provider in Settings (stored in your extension) to compile.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={!ai.data?.configured || !words.length || compile.isPending} onClick={() => compile.mutate()} size="sm"><Sparkles size={15} />{compile.isPending ? "Compiling…" : "Compile with my AI"}</Button>
      {result && <Button disabled={!result.skills.length || publish.isPending} onClick={() => publish.mutate()} size="sm" variant="secondary">{publish.isPending ? "Publishing…" : `Publish ${result.skills.length} skills`}</Button>}
    </div>
    {result && <CompiledPreview result={result} />}
  </Card>;
}

function CompiledPreview({ result }: { result: CompileResult }) {
  return <div className="mt-4 space-y-3">
    {result.unmapped.length > 0 && <p className="text-sm text-warning">{result.unmapped.length} raw words were not placed in any skill and will not be counted: {result.unmapped.slice(0, 12).join(", ")}{result.unmapped.length > 12 ? "…" : ""}</p>}
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="py-2 pr-2">Skill</th><th className="py-2 pr-2">Category</th><th className="py-2">Raw words merged</th></tr></thead>
        <tbody>{result.skills.map((skill) => <tr className="border-t border-border align-top" key={skill.name}>
          <td className="py-2 pr-2 font-semibold">{skill.name}</td><td className="py-2 pr-2 text-muted">{skill.category}</td><td className="py-2 text-xs text-muted">{skill.aliases.join(", ")}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
