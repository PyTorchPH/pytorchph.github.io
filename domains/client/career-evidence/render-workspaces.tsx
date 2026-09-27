"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  GitBranch,
  Globe2,
  ImageIcon,
  Link2,
  LockKeyhole,
  Network,
  Pencil,
  Plug,
  RefreshCw,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Unplug,
  Upload,
  UserCheck,
} from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { SegmentedTabs } from "@pytorch-ph/design-system/tabs";
import { Button } from "@pytorch-ph/design-system/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Textarea } from "@pytorch-ph/design-system/textarea";
import type {
  Connection,
  EvidenceItem,
  EvidenceSource,
  EvidenceSubmissionEnvelope,
  ProductViewData,
} from "@pytorch-ph/domain-protocol/career-evidence";
import {
  evidenceFormSchema,
  type EvidenceFormValues,
} from "@pytorch-ph/domain-protocol/career-evidence";
import {
  downloadDocx,
  downloadHtml,
  downloadPdf,
  resumePdfPageCount,
  resumeTemplates,
  type ResumeTemplateId,
} from "@pytorch-ph/domain-client/resumes";
import { collectEvidenceFromExtension, ExtensionCapabilityOverlay } from "@pytorch-ph/domain-client/client-automation";
import type { EvidenceIntegrityCase } from "@pytorch-ph/domain-protocol/organization";

const sourceTone = (source: EvidenceSource) =>
  source.connectionStatus === "connected"
    ? "success"
    : source.connectionStatus === "verification_required"
      ? "warning"
      : "default";
const verificationTone = (state: EvidenceItem["verificationState"]) =>
  state === "user_verified"
    ? "success"
    : state === "ai_proposed"
      ? "orange"
      : "default";

function SourceDialog({
  source,
  canWrite,
  canAutomate,
  onChanged,
  onClose,
}: {
  source: EvidenceSource;
  canWrite: boolean;
  canAutomate: boolean;
  onChanged: (source: EvidenceSource) => void;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState(source.configuredUrl || "");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EvidenceSubmissionEnvelope | null>(null);
  const connected = source.connectionStatus === "connected";
  const method =
    source.connectionMethod === "website_session"
      ? "Visible browser session"
      : source.connectionMethod === "url"
        ? "Submitted URL"
        : source.connectionMethod === "upload"
          ? "Private upload"
          : "Manual entry";
  const extensionRequired = source.connectionMethod === "website_session";
  const extensionSource = source.id === "facebook" || source.id === "linkedin" || source.id === "github" ? source.id : null;
  const extensionSupported = extensionSource !== null;
  const run = async (action: "connect" | "sync" | "disconnect") => {
    setBusy(true);
    setNotice("");
    try {
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
      onChanged(payload.source as EvidenceSource);
      setNotice(
        action === "sync"
          ? "Source collection completed and was recorded."
          : action === "disconnect"
            ? "Source disconnected."
            : "Source connection saved.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Source action failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const collect = async () => {
    if (!extensionSource) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await collectEvidenceFromExtension(extensionSource);
      setPreview(result);
      setNotice(`Preview ready: ${result.items.length} bounded item${result.items.length === 1 ? "" : "s"}. Review every item before submitting.`);
    } catch (error) {
      setPreview(null);
      setNotice(error instanceof Error ? error.message : "Evidence collection stopped safely.");
    } finally { setBusy(false); }
  };
  const submitPreview = async () => {
    if (!preview) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/evidence/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preview) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Evidence submission failed.");
      setPreview(null);
      onChanged({ ...source, status: "verified", connectionStatus: "connected", evidenceCount: (source.evidenceCount || 0) + (payload.duplicate ? 0 : payload.claimIds.length), lastSyncedAt: new Date().toISOString() });
      setNotice(payload.duplicate ? "This exact evidence revision was already submitted." : `${payload.claimIds.length} claim${payload.claimIds.length === 1 ? "" : "s"} sent for officer review.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Evidence submission failed."); }
    finally { setBusy(false); }
  };
  return (
    <AppDialog
      description="Connection controls never expose credentials, cookies, or raw browser state."
      onClose={onClose}
      title={source.label}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-elevated p-4">
          <p className="text-xs uppercase tracking-widest text-muted">Access</p>
          <p className="mt-2 font-semibold">{method}</p>
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
      <p className="mt-5 text-sm leading-6 text-muted">{source.description}</p>
      <div className="mt-5">
        <p className="text-sm font-semibold">Exact permissions</p>
        <ul className="mt-3 space-y-2">
          {source.permissions?.map((permission) => (
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
      {source.lastSyncedAt && (
        <p className="mt-5 text-xs text-muted">
          Last synchronized: {new Date(source.lastSyncedAt).toLocaleString()}
        </p>
      )}
      {source.connectionStatus === "verification_required" && (
        <div className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6">
          <AlertTriangle className="mr-2 inline text-warning" size={16} />
          Open a normal visible browser and complete verification yourself.
          Collection remains paused until then.
        </div>
      )}
      {!connected && source.connectionMethod === "url" && (
        <div className="mt-5">
          <Label htmlFor="source-url">Portfolio URL</Label>
          <Input
            id="source-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/portfolio"
            type="url"
            value={url}
          />
        </div>
      )}
      {notice && (
        <div
          aria-live="polite"
          className="mt-5 rounded-xl border border-accent/25 bg-accentSoft p-4 text-sm"
        >
          {notice}
        </div>
      )}
      {preview && <div className="mt-5 rounded-xl border border-accent/30 bg-elevated p-4"><p className="font-semibold">Review collected evidence</p><p className="mt-1 text-xs text-muted">Nothing is approved or awarded yet. Submitting creates immutable pending claims.</p><ul className="mt-3 max-h-64 space-y-3 overflow-auto">{preview.items.map((item) => <li className="rounded-lg border border-border bg-surface p-3" key={`${item.sourceUrl}:${item.title}`}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 line-clamp-3 text-xs text-muted">{item.text}</p><a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent" href={item.sourceUrl} rel="noreferrer" target="_blank">Open source <ExternalLink size={12}/></a></li>)}</ul></div>}
      {extensionRequired ? <ExtensionCapabilityOverlay capability={`${source.label} collection`} requiredCapability={source.id}><div className="mt-6 flex flex-wrap gap-2">
        <Button disabled={!canWrite || !canAutomate || busy || !extensionSupported} onClick={collect}><RefreshCw size={16}/>{preview ? "Collect a fresh preview" : "Preview visible source tab"}</Button>
        {preview && <Button disabled={!canWrite || busy} onClick={submitPreview} variant="secondary"><ShieldCheck size={16}/>Submit reviewed items</Button>}
        {connected && <Button disabled={!canWrite || busy} onClick={() => run("disconnect")} variant="outline">Disconnect</Button>}
      </div></ExtensionCapabilityOverlay> : <div className="mt-6 flex flex-wrap gap-2">
        {connected ? <><Button disabled={!canWrite || busy} onClick={() => run("sync")}><RefreshCw size={16}/>Sync selected evidence</Button><Button disabled={!canWrite || busy} onClick={() => run("disconnect")} variant="secondary">Disconnect</Button></> : <Button disabled={!canWrite || busy} onClick={() => run("connect")}><Plug size={16}/>Connect source</Button>}
      </div>}
    </AppDialog>
  );
}

function EvidenceDialog({
  item,
  canWrite,
  onClose,
  onSave,
}: {
  item: EvidenceItem;
  canWrite: boolean;
  onClose: () => void;
  onSave: (item: EvidenceItem) => Promise<void>;
}) {
  const [draft, setDraft] = useState(item);
  const [proposalVisible, setProposalVisible] = useState(
    item.verificationState === "ai_proposed",
  );
  const [consented, setConsented] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const form = useForm<EvidenceFormValues>({
    resolver: zodResolver(evidenceFormSchema),
    defaultValues: {
      evidenceKind: item.evidenceKind || "project",
      title: item.title,
      organization: item.organization,
      role: item.role,
      dateLabel: item.dateLabel,
      description: item.description,
      skillsText: item.skills.join(", "),
    },
  });
  const values = form.watch();
  const parsedSkills = values.skillsText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    <AppDialog
      description="Edit the source-of-truth achievement here. Resume Studio only reads approved facts."
      onClose={onClose}
      title={values.title}
      wide
    >
      <div className="grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
        <div>
          <Image
            alt={draft.mediaAlt}
            className="aspect-[4/3] w-full rounded-xl object-cover"
            height={900}
            src={draft.mediaUrl}
            unoptimized={draft.mediaUrl.startsWith("/api/")}
            width={1200}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={verificationTone(draft.verificationState)}>
              {draft.verificationState.replaceAll("_", " ")}
            </Badge>
            <Badge>{(draft.collectionOrigin || (draft.sourceId === "manual" ? "manual" : draft.sourceId === "upload" ? "upload" : "automated_scrape")).replaceAll("_", " ")}</Badge>
            {draft.confidence && (
              <Badge>{draft.confidence}% source match</Badge>
            )}
          </div>
          <div className="mt-5 rounded-xl border border-accent/25 bg-accentSoft p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles size={16} className="text-accent" />
              AI evidence assistant
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              EXIF is stripped. Only this selected photo and bounded source text
              are sent to the configured provider. AI can propose; only you can
              approve.
            </p>
            <label className="mt-4 flex items-start gap-2 text-xs">
              <input
                checked={consented}
                className="mt-0.5"
                onChange={(event) => setConsented(event.target.checked)}
                type="checkbox"
              />
              I approve analysis of this selected demo evidence.
            </label>
            <Button
              className="mt-4 w-full"
              disabled={!canWrite || !consented || analyzing}
              onClick={async () => {
                setAnalyzing(true);
                setAnalysisError("");
                try {
                  const response = await fetch(
                    "/api/product/evidence/analyze",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        consent: true,
                        evidenceId: draft.id,
                        current: {
                          title: values.title,
                          description: values.description,
                          skills: parsedSkills,
                        },
                      }),
                    },
                  );
                  const payload = await response.json();
                  if (!response.ok)
                    throw new Error(payload.error || "AI analysis failed.");
                  setDraft((current) => ({
                    ...current,
                    aiProposal: payload.proposal,
                    verificationState: "ai_proposed",
                  }));
                  setProposalVisible(true);
                } catch (error) {
                  setAnalysisError(
                    error instanceof Error
                      ? error.message
                      : "AI analysis failed.",
                  );
                } finally {
                  setAnalyzing(false);
                }
              }}
              size="sm"
            >
              <Bot size={15} />
              {analyzing ? "Analyzing…" : "Analyze selected evidence"}
            </Button>
            {analysisError && (
              <p className="mt-3 text-xs leading-5 text-danger">
                {analysisError}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="evidence-kind">Evidence type</Label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              id="evidence-kind"
              {...form.register("evidenceKind")}
            >
              <option value="project">Personal project</option>
              <option value="experience">Professional experience</option>
            </select>
          </div>
          <div>
            <Label htmlFor="evidence-title">Achievement title</Label>
            <Input
              id="evidence-title"
              {...form.register("title")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="evidence-org">Organization</Label>
              <Input
                id="evidence-org"
                {...form.register("organization")}
              />
            </div>
            {values.evidenceKind === "experience" && (
              <div>
                <Label htmlFor="evidence-role">Professional position</Label>
                <Input id="evidence-role" {...form.register("role")} />
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="evidence-date">Date</Label>
            <Input
              id="evidence-date"
              {...form.register("dateLabel")}
            />
          </div>
          <div>
            <Label htmlFor="evidence-description">Description</Label>
            <Textarea
              className="mt-1"
              id="evidence-description"
              {...form.register("description")}
            />
          </div>
          <div>
            <Label htmlFor="evidence-skills">Skills</Label>
            <Input
              id="evidence-skills"
              {...form.register("skillsText")}
            />
            {form.formState.errors.skillsText && (
              <p className="mt-1 text-xs text-danger">
                {form.formState.errors.skillsText.message}
              </p>
            )}
          </div>
          {proposalVisible && draft.aiProposal && (
            <div className="rounded-xl border border-accent/30 bg-accentSoft p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">AI proposal</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {draft.aiProposal.summary}
                  </p>
                </div>
                <Badge variant="orange">Review</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {draft.aiProposal.changes.map((proposal) => (
                  <div
                    className="rounded-lg border border-border bg-surface p-3"
                    key={proposal.field}
                  >
                    <p className="text-xs font-semibold">{proposal.field}</p>
                    <p className="mt-2 text-xs text-danger line-through">
                      {proposal.before}
                    </p>
                    <p className="mt-1 text-xs text-success">
                      {proposal.after}
                    </p>
                  </div>
                ))}
              </div>
              {draft.aiProposal.warnings.map((warning) => (
                <p
                  className="mt-3 flex gap-2 text-xs text-warning"
                  key={warning}
                >
                  <AlertTriangle size={13} />
                  {warning}
                </p>
              ))}
              <Button
                className="mt-4"
                onClick={() => {
                  const description = draft.aiProposal?.changes.find(
                    (changeItem) => changeItem.field === "Description",
                  )?.after;
                  const skills = draft.aiProposal?.changes.find(
                    (changeItem) => changeItem.field === "Skills",
                  )?.after;
                  if (description)
                    form.setValue("description", description, {
                      shouldValidate: true,
                    });
                  if (skills)
                    form.setValue("skillsText", skills, {
                      shouldValidate: true,
                    });
                  setDraft((current) => ({
                    ...current,
                    verificationState: "source_matched",
                  }));
                  setProposalVisible(false);
                }}
                size="sm"
              >
                <Check size={15} />
                Apply selected changes
              </Button>
            </div>
          )}
          {saveError && (
            <p aria-live="polite" className="text-sm text-danger">
              {saveError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button onClick={onClose} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!canWrite || saving}
              onClick={form.handleSubmit(async (formValues) => {
                setSaving(true);
                setSaveError("");
                try {
                  await onSave({
                    ...draft,
                    evidenceKind: formValues.evidenceKind || "project",
                    title: formValues.title,
                    organization: formValues.organization,
                    role: formValues.evidenceKind === "experience" ? formValues.role : "",
                    dateLabel: formValues.dateLabel,
                    description: formValues.description,
                    skills: formValues.skillsText
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                    verificationState: "user_verified",
                  });
                  onClose();
                } catch (error) {
                  setSaveError(
                    error instanceof Error
                      ? error.message
                      : "Could not save evidence.",
                  );
                } finally {
                  setSaving(false);
                }
              })}
            >
              <UserCheck size={16} />
              {saving ? "Saving…" : "Save & approve"}
            </Button>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}

function MemberIntegrityNotice() {
  const [cases, setCases] = useState<EvidenceIntegrityCase[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/evidence/integrity", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<EvidenceIntegrityCase[]> : []).then(setCases).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  if (!cases.length) return null;
  const active = cases[0];
  const appealOpen = active.appeal?.state === "open";
  return <Card className="border-warning/30 bg-warning/10"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 text-warning"/><div className="flex-1"><h2 className="font-bold">Leaderboard eligibility review</h2><p className="mt-2 text-sm leading-6 text-muted">{active.reason}</p><p className="mt-1 text-xs text-muted">Decision {new Date(active.imposedAt).toLocaleString()} · claim {active.claimId}</p>{appealOpen ? <p className="mt-4 rounded-lg border border-border bg-surface p-3 text-sm">Your appeal is open. An officer must review it before eligibility can change.</p> : <div className="mt-4"><Label htmlFor="integrity-appeal">Appeal note</Label><Textarea id="integrity-appeal" maxLength={1200} onChange={(event) => setNote(event.target.value)} placeholder="Explain which submitted source supports a review." value={note}/><Button className="mt-3" disabled={busy || note.trim().length < 10} onClick={async () => { setBusy(true); setNotice(""); try { const response = await fetch("/api/evidence/integrity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sanctionId: active.sanctionId, note }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Appeal could not be opened."); setNote(""); setNotice("Appeal opened for officer review."); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Appeal could not be opened."); } finally { setBusy(false); } }}>Open one appeal</Button></div>}{notice && <p aria-live="polite" className="mt-3 text-sm">{notice}</p>}</div></div></Card>;
}

type AddMode = "manual" | "automatic";

const addModes: Array<{ value: AddMode; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic (AI)" },
];

// Sources AI can read: a signed-in website session or a public URL. Uploads and manual entry are manual.
const isAutomaticSource = (source: EvidenceSource) =>
  source.connectionMethod === "website_session" || source.connectionMethod === "url";

export function CareerEvidenceView({
  data,
  canWrite,
  canAutomate,
}: {
  data: ProductViewData;
  canWrite: boolean;
  canAutomate: boolean;
}) {
  const evidence = data.evidence;
  const [source, setSource] = useState<EvidenceSource | null>(null);
  const [selected, setSelected] = useState<EvidenceItem | null>(null);
  const [items, setItems] = useState(evidence?.items || []);
  const [sources, setSources] = useState(evidence?.sources || []);
  const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  if (!evidence) return <Card>No evidence view is available.</Card>;
  const persist = async (item: EvidenceItem) => {
    const creating = item.id.startsWith("new-");
    const response = await fetch(
      creating ? "/api/product/evidence" : `/api/product/evidence/${item.id}`,
      {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, approve: true }),
      },
    );
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error || "Could not save evidence.");
    const saved = payload.item as EvidenceItem;
    setItems((current) =>
      creating
        ? [saved, ...current]
        : current.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
  };
  const startManual = () =>
    setSelected({
      id: `new-${crypto.randomUUID()}`,
      sourceId: "manual",
      title: "New career achievement",
      organization: "",
      role: "",
      dateLabel: "",
      description: "",
      quantitative: [],
      qualitative: [],
      skills: [],
      mediaUrl: "/demo/evidence/manual-placeholder.svg",
      mediaAlt: "Placeholder for manually entered career evidence",
      verificationState: "draft",
    });
  const upload = async (file: File) => {
    setUploading(true);
    setActionError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", file.name.replace(/\.[^.]+$/, ""));
      const response = await fetch("/api/product/evidence", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Could not upload evidence.");
      const item = payload.item as EvidenceItem;
      setItems((current) => [item, ...current]);
      setSelected(item);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not upload evidence.",
      );
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };
  return (
    <div className="space-y-4">
      <MemberIntegrityNotice />
      <Card className="bg-surface" data-tour="evidence-add">
        <CardHeader>
          <div>
            <CardTitle>Add evidence</CardTitle>
            <CardDescription>
              Enter it yourself, or let AI collect it from a source you
              connect.
            </CardDescription>
          </div>
          <div aria-label="How to add evidence" role="group">
            <SegmentedTabs items={addModes} onChange={setAddMode} value={addMode} />
          </div>
        </CardHeader>
        {addMode === "manual" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!canWrite} onClick={startManual} size="sm" variant="secondary">
              <Plus size={14} />
              Manual entry
            </Button>
            <Button disabled={!canWrite || uploading} onClick={() => uploadRef.current?.click()} size="sm">
              <Upload size={14} />
              {uploading ? "Preparing…" : "Upload photo"}
            </Button>
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload an evidence image"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              ref={uploadRef}
              type="file"
            />
            <p className="w-full text-sm text-muted">
              You write the details. Nothing is collected for you.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              Choose a source. AI reads only what you allow and proposes
              evidence; each proposal waits for your review before it counts.
              {!canAutomate && " Automatic collection is locked until an AI endpoint is configured in Settings."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sources.filter(isAutomaticSource).map((item) => (
                <button
                  className="focus-ring group border border-border bg-elevated p-4 text-left transition hover:border-accent/40"
                  key={item.id}
                  onClick={() => setSource(item)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center bg-surface text-accent">
                      {item.connectionMethod === "website_session" ? <Globe2 size={18} /> : <Link2 size={18} />}
                    </span>
                    <Badge variant={sourceTone(item)}>
                      {item.maturity === "available"
                        ? item.connectionStatus?.replaceAll("_", " ")
                        : item.maturity}
                    </Badge>
                  </div>
                  <p className="mt-4 font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{item.kind}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted">
                    <span>{item.evidenceCount || 0} items</span>
                    <ChevronRight className="transition group-hover:translate-x-1" size={15} />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
      <Card className="bg-surface">
        <CardHeader>
          <div>
            <CardTitle>Achievement gallery</CardTitle>
            <CardDescription>
              Open a photo to edit the user-owned fact or review an AI proposal.
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="success">
              {
                items.filter(
                  (item) => item.verificationState === "user_verified",
                ).length
              }{" "}
              verified
            </Badge>
          </div>
        </CardHeader>
        {actionError && (
          <p
            aria-live="polite"
            className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
          >
            {actionError}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <button
              className="focus-ring group overflow-hidden rounded-xl border border-border bg-elevated text-left"
              key={item.id}
              onClick={() => setSelected(item)}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  alt={item.mediaAlt}
                  className="object-cover transition duration-500 group-hover:scale-[1.03]"
                  fill
                  sizes="(max-width:768px) 100vw, 33vw"
                  src={item.mediaUrl}
                  unoptimized={item.mediaUrl.startsWith("/api/")}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent p-4 pt-12">
                  <Badge variant={verificationTone(item.verificationState)}>
                    {item.verificationState.replaceAll("_", " ")}
                  </Badge>
                </div>
              </div>
              <div className="p-4">
                <p className="font-semibold leading-6">{item.title}</p>
                <p className="mt-2 text-xs text-muted">
                  {item.organization} · {item.dateLabel}
                </p>
                <div className="mt-4 flex items-center justify-between text-xs text-accent">
                  <span className="flex items-center gap-1">
                    <Pencil size={13} />
                    Open achievement
                  </span>
                  <ChevronRight size={15} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>
      {evidence.blockers.length > 0 && (
        <Card className="border-warning/30 bg-warning/10">
          <CardHeader>
            <div>
              <CardTitle>Evidence blockers</CardTitle>
              <CardDescription>
                These require a real source or human action.
              </CardDescription>
            </div>
            <AlertTriangle className="text-warning" size={20} />
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {evidence.blockers.map((item) => (
              <li className="flex gap-2" key={item}>
                <CircleDot className="mt-1 flex-none text-warning" size={13} />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {source && (
        <SourceDialog
          canAutomate={canAutomate}
          canWrite={canWrite}
          onChanged={(updated) => {
            setSources((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setSource(updated);
          }}
          onClose={() => setSource(null)}
          source={source}
        />
      )}
      {selected && (
        <EvidenceDialog
          canWrite={canWrite}
          item={selected}
          onClose={() => setSelected(null)}
          onSave={persist}
        />
      )}
    </div>
  );
}

function ResumePreview({ templateId }: { templateId: ResumeTemplateId }) {
  return (
    <iframe
      allow="fullscreen"
      className="h-[72dvh] min-h-[520px] w-full rounded-xl border border-border bg-elevated"
      data-testid="resume-pdf-frame"
      sandbox="allow-downloads allow-popups allow-same-origin allow-scripts"
      src={`/career/resume-viewer?template=${templateId}`}
      title={`${templateId} actual PDF resume preview`}
    />
  );
}

export function ResumeStudioView({ data }: { data: ProductViewData }) {
  const [templateId, setTemplateId] = useState<ResumeTemplateId | null>(null);
  const [busy, setBusy] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const profile = data.resumeProfile;
  const template = resumeTemplates.find((item) => item.id === templateId);
  const demo = data.meta.mode === "local_demo";
  useEffect(() => {
    let active = true;
    setPageCount(null);
    if (profile && templateId)
      void resumePdfPageCount(profile, templateId)
        .then((count) => {
          if (active) setPageCount(count);
        })
        .catch(() => {
          if (active) setPageCount(0);
        });
    return () => {
      active = false;
    };
  }, [profile, templateId]);
  if (!profile)
    return (
      <Card className="border-dashed bg-surface py-12 text-center">
        <FileText className="mx-auto text-muted" />
        <h2 className="mt-4 font-bold">No verified resume snapshot</h2>
        <p className="mt-2 text-sm text-muted">
          Approve evidence in Career Evidence before selecting a template.
        </p>
      </Card>
    );
  const run = async (label: string, action: () => void | Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Card className="mb-4 border-accent/25 bg-accentSoft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <LockKeyhole className="mt-1 flex-none text-accent" size={20} />
            <div>
              <p className="font-semibold">Read-only normalized snapshot</p>
              <p className="mt-1 text-sm leading-6 text-muted">
                Templates inject approved Career Evidence. They cannot edit the
                underlying details.
              </p>
            </div>
          </div>
          <Link
            className="focus-ring inline-flex items-center gap-2 rounded-full border border-accent/30 px-4 py-2 text-sm font-semibold text-accent"
            href="/career/evidence"
          >
            Edit in Career Evidence <ArrowRight size={15} />
          </Link>
        </div>
      </Card>
      <section className="grid gap-4 md:grid-cols-3">
        {resumeTemplates.map((item, index) => (
          <button
            className="focus-ring group text-left"
            key={item.id}
            onClick={() => setTemplateId(item.id)}
          >
            <Card className="h-full bg-surface group-hover:border-accent/40">
              <div className="aspect-[3/4] rounded-xl border border-border bg-white p-5 text-slate-800 shadow-sm">
                <div
                  className="h-4 w-2/3 rounded"
                  style={{ backgroundColor: item.accent }}
                />
                <div className="mt-2 h-1.5 w-1/2 rounded bg-slate-300" />
                <div className="mt-6 space-y-4">
                  {Array.from({ length: index === 2 ? 6 : 5 }).map(
                    (_, lineIndex) => (
                      <div key={lineIndex}>
                        <div
                          className="h-1.5 w-1/3 rounded"
                          style={{ backgroundColor: item.accent }}
                        />
                        <div className="mt-2 h-1 w-full rounded bg-slate-200" />
                        <div className="mt-1 h-1 w-5/6 rounded bg-slate-200" />
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{item.name}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {item.description}
                  </p>
                </div>
                <Badge variant="success">ATS ready</Badge>
              </div>
              <p className="mt-4 flex items-center justify-between text-xs text-accent">
                <span>{item.density} density</span>
                <span className="flex items-center gap-1">
                  Preview <ChevronRight size={14} />
                </span>
              </p>
            </Card>
          </button>
        ))}
      </section>
      {templateId && template && (
        <AppDialog
          className="sm:max-w-[min(96vw,1440px)]"
          description={`${template.description} The preview is the actual generated PDF and opens fitted to the whole page.`}
          onClose={() => setTemplateId(null)}
          title={`${template.name} resume`}
          wide
        >
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
            <ResumePreview templateId={templateId} />
            <aside className="space-y-4">
              <div className="rounded-xl border border-border bg-elevated p-4">
                <p className="text-xs uppercase tracking-widest text-muted">
                  Measured PDF fit
                </p>
                <p
                  className={`mt-3 flex items-center gap-2 font-semibold ${pageCount === 1 ? "text-success" : pageCount && pageCount > 1 ? "text-warning" : "text-muted"}`}
                >
                  <CheckCircle2 size={17} />
                  {pageCount === null
                    ? "Measuring generated PDF…"
                    : pageCount === 0
                      ? "Measurement unavailable"
                      : `${pageCount}-page PDF generated`}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted">
                  Preview, page count, and PDF export share the same normalized
                  data and generator.
                </p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="font-semibold">Export this result</p>
                <div className="mt-4 grid gap-2">
                  <Button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run("HTML", () => downloadHtml(profile, templateId, demo))
                    }
                    variant="secondary"
                  >
                    <Download size={15} />
                    HTML
                  </Button>
                  <Button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run("DOCX", () => downloadDocx(profile, templateId, demo))
                    }
                    variant="secondary"
                  >
                    <Download size={15} />
                    Editable DOCX
                  </Button>
                  <Button
                    disabled={Boolean(busy) || pageCount === null}
                    onClick={() =>
                      run("PDF", () => downloadPdf(profile, templateId, demo))
                    }
                  >
                    <Download size={15} />
                    {busy || "PDF"}
                  </Button>
                </div>
              </div>
              <Link
              className="focus-ring flex items-center justify-between rounded-xl border border-accent/30 bg-accentSoft p-4 text-sm font-semibold text-accent"
                href="/career/evidence"
              >
                Edit source evidence <ExternalLink size={15} />
              </Link>
            </aside>
          </div>
        </AppDialog>
      )}
    </>
  );
}

export function ConnectionsWorkspaceView({ data }: { data: ProductViewData }) {
  const [selected, setSelected] = useState<Connection | null>(null);
  const [notice, setNotice] = useState("");
  const connections = useMemo(() => data.connections || [], [data.connections]);
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connections.length ? (
          connections.map((item) => {
            const connected = item.status === "connected";
            return (
              <button
                className="focus-ring group text-left"
                key={item.id}
                onClick={() => {
                  setSelected(item);
                  setNotice("");
                }}
              >
                <Card className="h-full bg-surface group-hover:border-accent/40">
                  <CardHeader>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${connected ? "bg-success/10 text-success" : "bg-elevated text-muted"}`}
                    >
                      {connected ? <Server size={20} /> : <Unplug size={20} />}
                    </div>
                    <Badge
                      variant={
                        connected
                          ? "success"
                          : item.status === "verification_required"
                            ? "warning"
                            : "default"
                      }
                    >
                      {item.status.replaceAll("_", " ")}
                    </Badge>
                  </CardHeader>
                  <h2 className="font-bold">{item.label}</h2>
                  <p className="mt-1 text-xs uppercase tracking-widest text-muted">
                    {item.category.replaceAll("_", " ")}
                  </p>
                  <p className="mt-4 text-sm leading-6 text-muted">
                    {item.detail}
                  </p>
                  <p className="mt-5 flex items-center justify-between text-xs font-semibold text-accent">
                    <span>
                      {connected ? "Manage connection" : "Connection options"}
                    </span>
                    <ChevronRight
                      className="transition group-hover:translate-x-1"
                      size={15}
                    />
                  </p>
                </Card>
              </button>
            );
          })
        ) : (
          <Card>No connection summaries.</Card>
        )}
      </section>
      {selected && (
        <AppDialog
          description="Connection state is sanitized; secrets and browser storage never appear here."
          onClose={() => setSelected(null)}
          title={selected.label}
        >
          <div className="rounded-xl border border-border bg-elevated p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">Current state</p>
              <Badge
                variant={
                  selected.status === "connected"
                    ? "success"
                    : selected.status === "verification_required"
                      ? "warning"
                      : "default"
                }
              >
                {selected.status.replaceAll("_", " ")}
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              {selected.detail}
            </p>
          </div>
          {selected.status === "verification_required" && (
            <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mr-2 inline text-warning" size={16} />A
              normal visible browser must be used. CAPTCHA and identity checks
              cannot be bypassed.
            </p>
          )}
          {notice && (
            <p className="mt-4 rounded-xl border border-accent/25 bg-accentSoft p-4 text-sm">
              {notice}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {selected.status === "connected" ? (
              <>
                <Button
                  onClick={() =>
                    setNotice(
                      "Connection check queued in preview; live checks run through the server gateway.",
                    )
                  }
                >
                  <RefreshCw size={15} />
                  Check connection
                </Button>
                <Button
                  onClick={() =>
                    setNotice(
                      "The live gateway requires confirmation before disconnecting.",
                    )
                  }
                  variant="secondary"
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                onClick={() =>
                  setNotice(
                    "Guided connection is ready. External verification remains a human step.",
                  )
                }
              >
                <Plug size={15} />
                {selected.status === "verification_required"
                  ? "Continue verification"
                  : "Connect"}
              </Button>
            )}
          </div>
        </AppDialog>
      )}
    </>
  );
}
