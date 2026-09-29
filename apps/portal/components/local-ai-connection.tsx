"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, FlaskConical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { aiClear, aiComplete, aiConfigure, aiStatus } from "@pytorch-ph/domain-client/client-automation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

type ProviderOption = { id: string; label: string; modelPlaceholder: string; apiKeyRequired: boolean; baseUrlRequired: boolean; defaultBaseUrl?: string; help: string };
export const LOCAL_AI_KEY = ["local-ai-status"];

// AI keys never reach the PyTorch PH server: they are stored in the member's browser extension,
// which also makes the provider calls.
export function LocalAIConnection() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: LOCAL_AI_KEY, queryFn: aiStatus });
  const providers = useQuery({ queryKey: ["local-ai-providers"], queryFn: () => fetchJson<{ providers: ProviderOption[] }>("/api/backend/local-ai/providers", { cache: "no-store" }) });
  const [provider, setProvider] = useState("google");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  useEffect(() => {
    if (!status.data?.configured) return;
    setProvider(status.data.provider); setModel(status.data.model); setBaseUrl(status.data.baseUrl); setApiVersion(status.data.apiVersion);
  }, [status.data]);
  const selected = providers.data?.providers.find((item) => item.id === provider);
  const extensionMissing = status.isSuccess && status.data === null;
  const refresh = () => client.invalidateQueries({ queryKey: LOCAL_AI_KEY });

  const save = useMutation({
    mutationFn: () => aiConfigure({ provider, model, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, apiVersion: apiVersion || undefined }),
    onSuccess: async (saved) => { setApiKey(""); await refresh(); toast.success(saved.permissionNeeded ? "Saved. Allow the endpoint in the extension to finish." : "AI connection saved in your extension."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "AI settings could not be saved."),
  });
  const test = useMutation({
    mutationFn: () => aiComplete({ prompt: "Reply with the single word READY.", maxTokens: 10 }),
    onSuccess: (reply) => toast.success(`AI connection works: ${reply.trim().slice(0, 40) || "READY"}`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "AI connection test failed."),
  });
  const clear = useMutation({
    mutationFn: aiClear,
    onSuccess: async () => { setApiKey(""); setModel(""); await refresh(); toast.success("AI key removed from this browser."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove the AI key."),
  });

  const keyStored = Boolean(status.data?.apiKeyPresent && status.data.provider === provider);
  const canSave = Boolean(model) && !(selected?.baseUrlRequired && !baseUrl) && !(selected?.apiKeyRequired && !apiKey && !keyStored);
  return <Card className="mt-4 bg-surface" data-tour="settings-grid" id="ai">
    <CardHeader><div><CardTitle>AI connection</CardTitle><CardDescription>Your provider and key are stored only in the PyTorch PH extension on this browser. The extension calls the provider directly; nothing is saved on PyTorch PH servers.</CardDescription></div><Cpu aria-hidden="true" className="text-accent" /></CardHeader>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Badge variant={status.data?.configured && !status.data.permissionNeeded ? "success" : "warning"}>{extensionMissing ? "Extension required" : status.data?.configured ? status.data.permissionNeeded ? "Permission needed" : "Configured" : "Setup required"}</Badge>
      {status.data?.configured && <span className="text-xs text-muted">{status.data.provider} · {status.data.model}{status.data.apiKeyPresent ? " · key stored locally" : ""}</span>}
    </div>
    {extensionMissing ? <p className="text-sm text-muted">Install the PyTorch PH extension to connect an AI provider. <Link className="font-semibold text-accent underline underline-offset-2" href="/setup/evidence-extension">How to install</Link></p> : <>
      {status.data?.permissionNeeded && <p className="mb-3 border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Open the PyTorch PH extension from your browser toolbar and allow access to {status.data.permissionNeeded.replace("/*", "")}, then test the connection.</p>}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <div><Label htmlFor="ai-provider">Provider</Label><select className="focus-ring h-11 w-full rounded-lg border border-border bg-elevated px-3 text-sm" id="ai-provider" onChange={(event) => { const next = providers.data?.providers.find((item) => item.id === event.target.value); setProvider(event.target.value); setModel(""); setBaseUrl(next?.defaultBaseUrl || ""); setApiKey(""); }} value={provider}>{providers.data?.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div><Label htmlFor="ai-model">Model {provider === "azure" ? "deployment" : provider === "other" ? "route" : "name"}</Label><Input id="ai-model" onChange={(event) => setModel(event.target.value)} placeholder={selected?.modelPlaceholder || "model"} value={model} /></div>
        <div><Label htmlFor="ai-key">API key {selected?.apiKeyRequired ? "(required)" : "(optional)"}</Label><Input autoComplete="off" id="ai-key" onChange={(event) => setApiKey(event.target.value)} placeholder={keyStored ? "Stored in extension · leave blank to keep" : "Paste provider API key"} type="password" value={apiKey} /></div>
        <div><Label htmlFor="ai-base-url">API base URL {selected?.baseUrlRequired ? "(required)" : "(optional)"}</Label><Input id="ai-base-url" onChange={(event) => setBaseUrl(event.target.value)} placeholder={selected?.defaultBaseUrl || "Provider default"} type="url" value={baseUrl} /></div>
      </div>
      {provider === "azure" && <div className="mt-3 max-w-xs"><Label htmlFor="ai-api-version">API version</Label><Input id="ai-api-version" onChange={(event) => setApiVersion(event.target.value)} placeholder="2024-10-21" value={apiVersion} /></div>}
      <p className="mt-3 text-xs text-muted">{selected?.help}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()} type="button">{save.isPending ? "Saving…" : "Save in extension"}</Button>
        <Button disabled={!status.data?.configured || test.isPending} onClick={() => test.mutate()} type="button" variant="outline"><FlaskConical aria-hidden="true" size={16} />{test.isPending ? "Testing…" : "Test connection"}</Button>
        {status.data?.configured && <Button disabled={clear.isPending} onClick={() => clear.mutate()} type="button" variant="ghost"><Trash2 aria-hidden="true" size={16} />Remove key</Button>}
      </div>
    </>}
  </Card>;
}
