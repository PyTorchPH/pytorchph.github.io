"use client";

import Link from "next/link";
import { AccountBinding } from "@pytorch-ph/domain-client/career-evidence";
import { PrivacyControls } from "@pytorch-ph/domain-client/privacy-feedback";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Eye, FlaskConical, LockKeyhole, UserCog } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { LeaveCommunity } from "../../components/leave-community";
import type { LeaderboardIdentitySettings } from "@pytorch-ph/domain-protocol/leaderboards";

type Mode = LeaderboardIdentitySettings["mode"];
type LocalAIStatus = { configured: boolean; provider: string; baseUrl: string; model: string; apiKeyPresent: boolean; apiVersion: string; project: string; region: string; middleware: string; source: string };
type ProviderOption = { id: string; label: string; modelPlaceholder: string; apiKeyRequired: boolean; baseUrlRequired: boolean; defaultBaseUrl?: string; help: string };

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["leaderboard-identity"], queryFn: () => fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { cache: "no-store" }) });
  const aiQuery = useQuery({ queryKey: ["local-ai-status"], queryFn: () => fetchJson<LocalAIStatus>("/api/backend/local-ai/status", { cache: "no-store" }) });
  const providerQuery = useQuery({ queryKey: ["local-ai-providers"], queryFn: () => fetchJson<{ middleware: string; providers: ProviderOption[] }>("/api/backend/local-ai/providers", { cache: "no-store" }) });
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<Mode>("nickname");
  const [consent, setConsent] = useState(false);
  const [availability, setAvailability] = useState<"idle" | "available" | "unavailable">("idle");
  const [aiProvider, setAiProvider] = useState("google");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiApiVersion, setAiApiVersion] = useState("");
  const [aiProject, setAiProject] = useState("");
  const [aiRegion, setAiRegion] = useState("");
  useEffect(() => { if (query.data) { setUsername(query.data.username); setMode(query.data.mode); setConsent(query.data.realNameConsent); } }, [query.data]);
  useEffect(() => { if (aiQuery.data?.configured) { setAiProvider(aiQuery.data.provider); setAiBaseUrl(aiQuery.data.baseUrl); setAiModel(aiQuery.data.model); setAiApiVersion(aiQuery.data.apiVersion); setAiProject(aiQuery.data.project); setAiRegion(aiQuery.data.region); } }, [aiQuery.data]);
  const mutation = useMutation({
    mutationFn: () => fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, mode, realNameConsent: consent }) }),
    onSuccess: (saved) => { queryClient.setQueryData(["leaderboard-identity"], saved); queryClient.invalidateQueries({ queryKey: ["member-leaderboard"] }); toast.success("Leaderboard identity saved."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Settings could not be saved."),
  });
  const aiMutation = useMutation({
    mutationFn: () => fetchJson<LocalAIStatus>("/api/backend/local-ai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: aiProvider, base_url: aiBaseUrl || null, model: aiModel, api_key: aiKey || null, api_version: aiApiVersion || null, project: aiProject || null, region: aiRegion || null }) }),
    onSuccess: (saved) => { queryClient.setQueryData(["local-ai-status"], saved); queryClient.invalidateQueries({ queryKey: ["capabilities"] }); setAiKey(""); toast.success("Local AI settings saved. Resume and scraper gates are now enabled."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "AI settings could not be saved."),
  });
  const testMutation = useMutation({
    mutationFn: () => fetchJson<{ ok: boolean; response: string }>("/api/backend/local-ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    onSuccess: (result) => toast.success(`AI connection passed: ${result.response || "READY"}`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "AI connection test failed."),
  });
  async function checkAvailability() {
    try {
      const result = await fetchJson<{ available: boolean }>(`/api/member/leaderboard-identity?username=${encodeURIComponent(username)}`, { cache: "no-store" });
      setAvailability(result.available ? "available" : "unavailable");
    } catch { setAvailability("unavailable"); }
  }
  const preview = mode === "anonymous" ? "Member #7A82F (changes each season)" : mode === "real_name" ? consent ? "Your account display name" : "Consent required" : username || "Your username";
  const selectedProvider = providerQuery.data?.providers.find((provider) => provider.id === aiProvider);

  return <AppShell>
    <div className="page-hero flex flex-wrap items-center justify-between gap-3" data-tour="settings-heading">
      <div><h1 className="text-3xl font-bold tracking-[-0.02em]">Settings</h1><p className="mt-2 text-muted">Your connected accounts, leaderboard identity, privacy and integrity, and AI connection.</p></div>
      <Badge variant="orange">Private by default</Badge>
    </div>
    <Card className="mb-4 bg-surface">
      <CardHeader><div><CardTitle>Model-agnostic AI connection</CardTitle><CardDescription>LiteLLM is the middleware between every product pipeline and Google Gemini, Anthropic Claude, OpenAI, OpenRouter, Azure, or local models. Provider-specific request and response shapes never enter the resume or scraper code.</CardDescription></div><Cpu className="text-accent" /></CardHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant={aiQuery.data?.configured ? "success" : "warning"}>{aiQuery.data?.configured ? "Configured" : "Setup required"}</Badge><Badge>LiteLLM middleware</Badge><span className="text-xs text-muted">Each member supplies only the credentials and fields required by their chosen provider.</span></div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <div><Label htmlFor="ai-provider">Provider</Label><select className="focus-ring h-11 w-full rounded-lg border border-border bg-elevated px-3 text-sm" id="ai-provider" onChange={(event) => { const next = providerQuery.data?.providers.find((provider) => provider.id === event.target.value); setAiProvider(event.target.value); setAiModel(""); setAiBaseUrl(next?.defaultBaseUrl || ""); setAiKey(""); }} value={aiProvider}>{providerQuery.data?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></div>
        <div><Label htmlFor="ai-model">Model {aiProvider === "other" ? "route" : "name"}</Label><Input id="ai-model" onChange={(event) => setAiModel(event.target.value)} placeholder={selectedProvider?.modelPlaceholder || "provider/model"} value={aiModel} /></div>
        <div><Label htmlFor="ai-key">API key {selectedProvider?.apiKeyRequired ? "(required)" : "(optional)"}</Label><Input autoComplete="off" id="ai-key" onChange={(event) => setAiKey(event.target.value)} placeholder={aiQuery.data?.apiKeyPresent && aiQuery.data.provider === aiProvider ? "Saved · leave blank to keep" : "Paste provider API key"} type="password" value={aiKey} /></div>
        <div><Label htmlFor="ai-base-url">API base URL {selectedProvider?.baseUrlRequired ? "(required)" : "(optional)"}</Label><Input id="ai-base-url" onChange={(event) => setAiBaseUrl(event.target.value)} placeholder={selectedProvider?.defaultBaseUrl || "Provider default"} type="url" value={aiBaseUrl} /></div>
      </div>
      <p className="mt-3 text-xs text-muted">{selectedProvider?.help}</p>
      <details className="mt-4 rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">Advanced provider parameters</summary><div className="mt-3 grid gap-4 md:grid-cols-3"><div><Label htmlFor="ai-api-version">API version</Label><Input id="ai-api-version" onChange={(event) => setAiApiVersion(event.target.value)} placeholder="Optional · commonly Azure" value={aiApiVersion} /></div><div><Label htmlFor="ai-project">Cloud project</Label><Input id="ai-project" onChange={(event) => setAiProject(event.target.value)} placeholder="Optional · Vertex AI" value={aiProject} /></div><div><Label htmlFor="ai-region">Region / location</Label><Input id="ai-region" onChange={(event) => setAiRegion(event.target.value)} placeholder="Optional · Vertex/Bedrock" value={aiRegion} /></div></div></details>
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!aiModel || Boolean(selectedProvider?.baseUrlRequired && !aiBaseUrl) || Boolean(selectedProvider?.apiKeyRequired && !aiKey && !(aiQuery.data?.apiKeyPresent && aiQuery.data.provider === aiProvider)) || aiMutation.isPending} onClick={() => aiMutation.mutate()} type="button">{aiMutation.isPending ? "Saving…" : "Save AI connection"}</Button><Button disabled={!aiQuery.data?.configured || testMutation.isPending} onClick={() => testMutation.mutate()} type="button" variant="outline"><FlaskConical size={16} />{testMutation.isPending ? "Testing…" : "Test connection"}</Button></div>
    </Card>
    <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]" data-tour="settings-grid">
      <Card className="bg-surface" data-tour="settings-privacy">
        <CardHeader><div><CardTitle>Leaderboard identity</CardTitle><CardDescription>Usernames are unique without regard to case. Revoking real-name consent takes effect on the next leaderboard read.</CardDescription></div><UserCog className="text-accent" /></CardHeader>
        {query.data?.reviewRequired && <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Review the generated username before continuing.</div>}
        <div className="space-y-5">
          <div><Label htmlFor="leaderboard-username">Username</Label><div className="flex gap-2"><Input id="leaderboard-username" maxLength={24} minLength={3} onChange={(event) => { setUsername(event.target.value); setAvailability("idle"); }} pattern="[A-Za-z0-9_-]{3,24}" value={username} /><Button onClick={checkAvailability} type="button" variant="outline">Check</Button></div><p className="mt-2 text-xs text-muted">3–24 characters: letters, numbers, underscore, or hyphen.</p>{availability !== "idle" && <p className={`mt-2 text-xs ${availability === "available" ? "text-success" : "text-warning"}`}>{availability === "available" ? "Username is available." : "Username is invalid or unavailable."}</p>}</div>
          <fieldset><legend className="mb-2 text-sm font-semibold">Display mode</legend><div className="grid gap-2">{([['nickname','Nickname','Show your required username.'],['anonymous','Anonymous','Use a season-scoped Member # label.'],['real_name','Real name','Show your account display name only with consent.']] as const).map(([value,label,detail]) => <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3" key={value}><input checked={mode===value} name="identity-mode" onChange={() => setMode(value)} type="radio" /><span><span className="block font-semibold">{label}</span><span className="text-xs text-muted">{detail}</span></span></label>)}</div></fieldset>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3"><input checked={consent} onChange={(event) => { setConsent(event.target.checked); if (!event.target.checked && mode === "real_name") setMode("nickname"); }} type="checkbox" /><span><span className="block font-semibold">I explicitly consent to real-name leaderboard visibility.</span><span className="text-xs text-muted">Clear this at any time to revoke real-name display immediately.</span></span></label>
          <Button disabled={query.isLoading || mutation.isPending || !username} onClick={() => mutation.mutate()} type="button">{mutation.isPending ? "Saving…" : "Save identity"}</Button>
        </div>
      </Card>
      <div className="space-y-4"><Card className="bg-surface"><CardHeader><div><CardTitle>Member preview</CardTitle><CardDescription>Exactly how your label is intended to appear.</CardDescription></div><Eye className="text-accent" /></CardHeader><div className="rounded-xl border border-accent/30 bg-accentSoft p-5 text-center text-xl font-bold">{preview}</div></Card><Card className="bg-surface"><CardHeader><div><CardTitle>Never included</CardTitle><CardDescription>Leaderboard payloads exclude private career and account data.</CardDescription></div><LockKeyhole className="text-success" /></CardHeader><p className="text-sm leading-6 text-muted">No UUID, email, avatar, bio, department, job history, projects, resumes, evidence text or IDs, source URLs, activity timestamps, or diagnostics.</p></Card></div>
    </section>
    <AccountBinding />
    <Card className="mt-4 bg-surface" id="privacy">
      <CardHeader><div><CardTitle>Privacy &amp; integrity</CardTitle><CardDescription>Choose what leaves your device and what other members see. <Link className="text-accent underline underline-offset-2" href="/trust">How your data is protected and verified</Link></CardDescription></div><LockKeyhole aria-hidden="true" className="text-accent" /></CardHeader>
      <PrivacyControls />
    </Card>
    <LeaveCommunity />
  </AppShell>;
}
