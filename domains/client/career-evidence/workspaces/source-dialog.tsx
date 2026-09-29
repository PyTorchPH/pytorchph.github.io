"use client";

// One evidence source: what it can read, and the controls to connect, collect, submit or disconnect.
// Module map (caller-first):
//   SourceDialog            composes the facts, notices, preview and controls
//   useSourceActions        state plus the connect/sync/disconnect, collect and submit flows
//     postSourceAction      POST /api/product/sources/{id}
//     submitPreviewEnvelope sends reviewed items to the official API (or the local gateway)
//     sourceActionNotice    confirmation text for a finished source action
//   SourceFacts, PermissionList, VerificationPausedNotice, PortfolioUrlField, CollectedPreview
//   SourceControls          extension-driven controls or direct connect/sync controls
//   extensionSourceOf       the extension adapter for this source, if any

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@pytorch-ph/design-system/button";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import type { EvidenceSource, EvidenceSubmissionEnvelope } from "@pytorch-ph/domain-protocol/career-evidence";
import { collectEvidenceFromExtension, ExtensionCapabilityOverlay } from "@pytorch-ph/domain-client/client-automation";
import { plural, sourceAccessLabel } from "./tones";

const officialApiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";

type SourceAction = "connect" | "sync" | "disconnect";
type ExtensionSource = "facebook" | "linkedin" | "github";
type SourceDialogProps = {
  source: EvidenceSource;
  canWrite: boolean;
  canAutomate: boolean;
  onChanged: (source: EvidenceSource) => void;
  onClose: () => void;
};

// Mental model: show what the source may read, then let the member act on it; every action reports back in the notice.
export function SourceDialog({ source, canWrite, canAutomate, onChanged, onClose }: SourceDialogProps) {
  const actions = useSourceActions(source, onChanged);
  return (
    <AppDialog
      description="Connection controls never expose credentials, cookies, or raw browser state."
      onClose={onClose}
      title={source.label}
    >
      <SourceFacts source={source} />
      <p className="mt-5 text-sm leading-6 text-muted">{source.description}</p>
      <PermissionList permissions={source.permissions} />
      {source.lastSyncedAt && (
        <p className="mt-5 text-xs text-muted">
          Last synchronized: {new Date(source.lastSyncedAt).toLocaleString()}
        </p>
      )}
      {source.connectionStatus === "verification_required" && <VerificationPausedNotice />}
      {!isConnected(source) && source.connectionMethod === "url" && <PortfolioUrlField onChange={actions.setUrl} url={actions.url} />}
      {actions.notice && (
        <div
          aria-live="polite"
          className="mt-5 rounded-xl border border-accent/25 bg-accentSoft p-4 text-sm"
        >
          {actions.notice}
        </div>
      )}
      {actions.preview && <CollectedPreview preview={actions.preview} />}
      <SourceControls actions={actions} canAutomate={canAutomate} canWrite={canWrite} source={source} />
    </AppDialog>
  );
}

// Mental model: one busy flag and one notice cover every flow; each flow clears the notice, runs, then reports.
function useSourceActions(source: EvidenceSource, onChanged: (source: EvidenceSource) => void) {
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState(source.configuredUrl || "");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EvidenceSubmissionEnvelope | null>(null);
  const extensionSource = extensionSourceOf(source);

  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try { await work(); } finally { setBusy(false); }
  };

  const run = (action: SourceAction) => withBusy(async () => {
    try {
      onChanged(await postSourceAction(source, action, url));
      setNotice(sourceActionNotice(action));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Source action failed.");
    }
  });

  const collect = async () => {
    if (!extensionSource) return;
    await withBusy(async () => {
      try {
        const result = await collectEvidenceFromExtension(extensionSource);
        setPreview(result);
        setNotice(`Preview ready: ${result.items.length} bounded item${plural(result.items.length)}. Review every item before submitting.`);
      } catch (error) {
        setPreview(null);
        setNotice(error instanceof Error ? error.message : "Evidence collection stopped safely.");
      }
    });
  };

  const submitPreview = async () => {
    if (!preview) return;
    await withBusy(async () => {
      try {
        const payload = await submitPreviewEnvelope(preview);
        setPreview(null);
        const outcome = submissionOutcome(source, payload);
        onChanged(outcome.source);
        setNotice(outcome.notice);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Evidence submission failed.");
      }
    });
  };

  return { notice, url, setUrl, busy, preview, extensionSource, run, collect, submitPreview };
}

type SourceActions = ReturnType<typeof useSourceActions>;

async function postSourceAction(source: EvidenceSource, action: SourceAction, url: string): Promise<EvidenceSource> {
  const response = await fetch(`/api/product/sources/${source.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      confirmation: action === "disconnect",
      url,
    }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Source action failed.");
  return payload.source as EvidenceSource;
}

const sourceActionNotice = (action: SourceAction) =>
  action === "sync"
    ? "Source collection completed and was recorded."
    : action === "disconnect"
      ? "Source disconnected."
      : "Source connection saved.";

type SubmissionPayload = { submitted?: number; duplicates?: number; duplicate?: boolean; claimIds?: string[]; error?: string };

async function submitPreviewEnvelope(preview: EvidenceSubmissionEnvelope): Promise<SubmissionPayload> {
  const response = await fetch(officialApiOrigin ? `${officialApiOrigin}/evidence/extension` : "/api/evidence/submissions", {
    method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preview),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Evidence submission failed.");
  return payload as SubmissionPayload;
}

// The official API counts submitted claims; the local gateway returns claim ids and marks the source verified.
function submissionOutcome(source: EvidenceSource, payload: SubmissionPayload) {
  const lastSyncedAt = new Date().toISOString();
  if (officialApiOrigin) {
    const submitted = payload.submitted as number;
    return {
      source: { ...source, evidenceCount: (source.evidenceCount || 0) + submitted, lastSyncedAt },
      notice: `${submitted} official claim${plural(submitted)} submitted for officer review; ${payload.duplicates} already submitted.`,
    };
  }
  const claimCount = (payload.claimIds as string[]).length;
  return {
    source: { ...source, status: "verified", connectionStatus: "connected", evidenceCount: (source.evidenceCount || 0) + (payload.duplicate ? 0 : claimCount), lastSyncedAt } as EvidenceSource,
    notice: payload.duplicate ? "This exact evidence revision was already submitted." : `${claimCount} claim${plural(claimCount)} sent for officer review.`,
  };
}

function SourceFacts({ source }: { source: EvidenceSource }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-elevated p-4">
        <p className="text-xs uppercase tracking-widest text-muted">Access</p>
        <p className="mt-2 font-semibold">{sourceAccessLabel(source)}</p>
      </div>
      <div className="rounded-xl border border-border bg-elevated p-4">
        <p className="text-xs uppercase tracking-widest text-muted">
          Evidence collected
        </p>
        <p className="data-label mt-2 text-2xl font-bold">
          {source.evidenceCount || 0}
        </p>
      </div>
    </div>
  );
}

function PermissionList({ permissions }: { permissions: EvidenceSource["permissions"] }) {
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold">Exact permissions</p>
      <ul className="mt-3 space-y-2">
        {permissions?.map((permission) => (
          <li
            className="flex items-center gap-2 text-sm text-muted"
            key={permission}
          >
            <Check size={14} className="text-success" />
            {permission}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerificationPausedNotice() {
  return (
    <div className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6">
      <AlertTriangle className="mr-2 inline text-warning" size={16} />
      Open a normal visible browser and complete verification yourself.
      Collection remains paused until then.
    </div>
  );
}

function PortfolioUrlField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  return (
    <div className="mt-5">
      <Label htmlFor="source-url">Portfolio URL</Label>
      <Input
        id="source-url"
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://example.com/portfolio"
        type="url"
        value={url}
      />
    </div>
  );
}

function CollectedPreview({ preview }: { preview: EvidenceSubmissionEnvelope }) {
  return <div className="mt-5 rounded-xl border border-accent/30 bg-elevated p-4"><p className="font-semibold">Review collected evidence</p><p className="mt-1 text-xs text-muted">Nothing is approved or awarded yet. Submitting creates immutable pending claims.</p><ul className="mt-3 max-h-64 space-y-3 overflow-auto">{preview.items.map((item) => <li className="rounded-lg border border-border bg-surface p-3" key={`${item.sourceUrl}:${item.title}`}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 line-clamp-3 text-xs text-muted">{item.text}</p><a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent" href={item.sourceUrl} rel="noreferrer" target="_blank">Open source <ExternalLink size={12}/></a></li>)}</ul></div>;
}

// Mental model: website-session sources run through the extension; everything else connects directly.
function SourceControls({ source, actions, canWrite, canAutomate }: { source: EvidenceSource; actions: SourceActions; canWrite: boolean; canAutomate: boolean }) {
  const connected = isConnected(source);
  if (requiresExtension(source)) {
    return <ExtensionCapabilityOverlay capability={`${source.label} collection`} requiredCapability={source.id}><div className="mt-6 flex flex-wrap gap-2">
      <Button disabled={!canWrite || !canAutomate || actions.busy || actions.extensionSource === null} onClick={actions.collect}><RefreshCw size={16}/>{actions.preview ? "Collect a fresh preview" : "Preview visible source tab"}</Button>
      {actions.preview && <Button disabled={!canWrite || actions.busy} onClick={actions.submitPreview} variant="secondary"><ShieldCheck size={16}/>Submit reviewed items</Button>}
      {connected && <Button disabled={!canWrite || actions.busy} onClick={() => actions.run("disconnect")} variant="outline">Disconnect</Button>}
    </div></ExtensionCapabilityOverlay>;
  }
  return <div className="mt-6 flex flex-wrap gap-2">
    {connected ? <><Button disabled={!canWrite || actions.busy} onClick={() => actions.run("sync")}><RefreshCw size={16}/>Sync selected evidence</Button><Button disabled={!canWrite || actions.busy} onClick={() => actions.run("disconnect")} variant="secondary">Disconnect</Button></> : <Button disabled={!canWrite || actions.busy} onClick={() => actions.run("connect")}><Plug size={16}/>Connect source</Button>}
  </div>;
}

const isConnected = (source: EvidenceSource) => source.connectionStatus === "connected";
const requiresExtension = (source: EvidenceSource) => source.connectionMethod === "website_session";

function extensionSourceOf(source: EvidenceSource): ExtensionSource | null {
  return source.id === "facebook" || source.id === "linkedin" || source.id === "github" ? source.id : null;
}
