"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Globe2, Link2, Puzzle, Smartphone } from "lucide-react";
import { useEvidenceExtension, type ExtensionStatus } from "@pytorch-ph/domain-client/client-automation";
import { useCapability } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import type { EvidenceSource, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { isAutomaticSource, SourceDialog, sourceTone } from "./render-workspaces";

const extensionLabels: Record<ExtensionStatus["state"], { label: string; tone: "success" | "warning" | "default" }> = {
  checking: { label: "Checking…", tone: "default" },
  available: { label: "Installed", tone: "success" },
  outdated: { label: "Update needed", tone: "warning" },
  missing: { label: "Not installed", tone: "warning" },
  permission_required: { label: "Permission needed", tone: "warning" },
  error: { label: "Not responding", tone: "warning" },
};

const subscribe = () => () => undefined;
// Phones and the installed app cannot run browser extensions.
const readIsPhoneOrApp = () => window.matchMedia("(display-mode: standalone)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Bind accounts so evidence can be collected from them. Collection runs in the member's own browser
// through the PyTorch PH extension, so it works on the website only.
export function AccountBinding() {
  const extension = useEvidenceExtension();
  const phoneOrApp = useSyncExternalStore(subscribe, readIsPhoneOrApp, () => false);
  const canWrite = useCapability("evidence_write").state === "available";
  const canAutomate = useCapability("evidence_scrape").state === "available";
  const query = useQuery({ queryKey: queryKeys.product("career-evidence"), queryFn: () => fetchJson<ProductViewData>("/api/product/career-evidence", { cache: "no-store" }) });
  const [sources, setSources] = useState<EvidenceSource[]>([]);
  const [selected, setSelected] = useState<EvidenceSource | null>(null);
  useEffect(() => { if (query.data?.evidence) setSources(query.data.evidence.sources.filter(isAutomaticSource)); }, [query.data]);
  const status = extensionLabels[extension.state];

  return <Card className="mt-4 bg-surface" data-tour="settings-accounts" id="accounts">
    <CardHeader>
      <div>
        <div className="flex items-center gap-2">
          <CardTitle>Connected accounts</CardTitle>
          <InfoPopover label="About connected accounts" title="How account binding works">
            <p>Binding an account lets PyTorch PH collect evidence of your work from it, such as projects and posts that you choose.</p>
            <p className="mt-2">Collection runs in <strong>your own browser</strong> through the PyTorch PH extension, using the session you are already signed in to. Your passwords and cookies are never sent to us.</p>
            <p className="mt-2 text-muted">Everything collected waits for your review, then for an officer to verify it.</p>
          </InfoPopover>
        </div>
        <CardDescription>Bind your accounts to collect evidence automatically.</CardDescription>
      </div>
      <Link2 aria-hidden="true" className="text-accent" size={20} />
    </CardHeader>

    <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-elevated p-3">
      <div className="flex items-center gap-3"><Puzzle aria-hidden="true" className="text-accent" size={20} /><div><p className="text-sm font-semibold">PyTorch PH browser extension</p><p className="text-xs text-muted">{extension.version ? `Version ${extension.version}` : "Required to collect from a signed-in account"}</p></div></div>
      <div className="flex flex-wrap items-center gap-3"><Badge variant={status.tone}>{status.label}</Badge>{extension.state !== "available" && <Link className="text-sm font-semibold text-accent underline underline-offset-2" href="/setup/evidence-extension">How to install</Link>}</div>
    </div>
    <p className="mt-3 flex items-start gap-2 text-sm text-muted"><Smartphone aria-hidden="true" className="mt-0.5 flex-none" size={16} /><span>{phoneOrApp ? "Account binding is not available on this device. Open pytorch.ph in a desktop browser to bind an account." : "Available on the website in a desktop browser only. The mobile app cannot run the browser extension."}</span></p>

    {query.isError ? <p className="mt-4 text-sm text-muted">Accounts are unavailable right now.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => <li key={source.id}>
        <button className="focus-ring group flex w-full items-center justify-between gap-3 border border-border bg-elevated p-3 text-left hover:border-accent/40" onClick={() => setSelected(source)} type="button">
          <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 flex-none items-center justify-center bg-surface text-accent">{source.connectionMethod === "website_session" ? <Globe2 aria-hidden="true" size={18} /> : <Link2 aria-hidden="true" size={18} />}</span><span className="min-w-0"><span className="block truncate font-semibold">{source.label}</span><span className="block truncate text-xs text-muted">{source.kind}</span></span></span>
          <span className="flex flex-none items-center gap-2"><Badge variant={sourceTone(source)}>{source.maturity === "available" ? source.connectionStatus?.replaceAll("_", " ") : source.maturity}</Badge><ChevronRight aria-hidden="true" className="text-muted" size={15} /></span>
        </button>
      </li>)}
    </ul>}

    {selected && <SourceDialog canAutomate={canAutomate} canWrite={canWrite} onChanged={(next) => { setSources((current) => current.map((item) => item.id === next.id ? next : item)); setSelected(next); }} onClose={() => setSelected(null)} source={selected} />}
  </Card>;
}
