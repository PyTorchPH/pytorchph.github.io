"use client";

import { useEffect, useState } from "react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";

type Draft = {
  id: string;
  revision: number;
  status: string;
  contentHash: string;
  pdfSha256: string | null;
  approvedRoles: string[];
  delivery: null | { status: string; claimedAt: string | null; externalMessageId: string | null };
  content: { recipients: string[]; subject: string; body: string; pdfText: string | null; requiredRoles: string[]; senderRole: string };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function MailWorkflow() {
  const [draftId, setDraftId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [category, setCategory] = useState("");
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pdfText, setPdfText] = useState("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [approvalRole, setApprovalRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [admin, setAdmin] = useState(false);
  const [reconcileStatus, setReconcileStatus] = useState<"sent" | "uncertain" | "failed">("uncertain");
  const [reconcileReason, setReconcileReason] = useState("");
  const [externalMessageId, setExternalMessageId] = useState("");
  const dirty = Boolean(draft) && (recipients !== draft!.content.recipients.join(", ") || subject !== draft!.content.subject || body !== draft!.content.body || pdfText !== (draft!.content.pdfText || ""));

  useEffect(() => {
    if (!draft?.pdfSha256) { setPdfPreviewUrl(""); return; }
    setPdfPreviewUrl("");
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`${apiOrigin}/mail/drafts/${encodeURIComponent(draft.id)}/pdf`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("PDF preview unavailable"); return response.blob(); })
      .then((blob) => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setPdfPreviewUrl(objectUrl); } })
      .catch(() => { if (!controller.signal.aborted) setPdfPreviewUrl(""); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [draft?.id, draft?.pdfSha256]);

  function apply(value: Draft) {
    setDraft(value);
    setDraftId(value.id);
    setRecipients(value.content.recipients.join(", "));
    setSubject(value.content.subject);
    setBody(value.content.body);
    setPdfText(value.content.pdfText || "");
    setApprovalRole(value.content.requiredRoles.find((role) => !value.approvedRoles.includes(role)) || value.content.requiredRoles[0] || "");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }

  async function load(id = draftId) {
    const value = await api<Draft>(`/mail/drafts/${encodeURIComponent(id.trim())}`);
    apply(value);
    const viewer = await api<{ role: string }>("/auth/me");
    setAdmin(viewer.role === "admin");
  }

  function create() {
    return run(async () => {
      const created = await api<{ id: string }>("/mail/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        category: category.trim(), recipients: recipients.split(",").map((value) => value.trim()).filter(Boolean), subject, body, pdfText: pdfText || null,
      }) });
      await load(created.id);
      setMessage("Draft created. Review the exact revision before approval.");
    });
  }

  function save() {
    if (!draft) return;
    return run(async () => {
      await api(`/mail/drafts/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": String(draft.revision) }, body: JSON.stringify({
        recipients: recipients.split(",").map((value) => value.trim()).filter(Boolean), subject, body, pdfText,
      }) });
      await load(draft.id);
      setMessage("New immutable revision saved; prior approvals no longer apply.");
    });
  }

  function approve() {
    if (!draft) return;
    return run(async () => {
      await api(`/mail/drafts/${draft.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: draft.revision, role: approvalRole }) });
      await load(draft.id);
      setMessage(`Revision ${draft.revision} approved for ${approvalRole}.`);
    });
  }

  function release() {
    if (!draft) return;
    return run(async () => {
      await api(`/mail/drafts/${draft.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: draft.revision }) });
      await load(draft.id);
      setMessage("Draft released to the disabled-by-default outbox.");
    });
  }

  function reconcile() {
    if (!draft) return;
    return run(async () => {
      await api(`/mail/drafts/${draft.id}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: reconcileStatus, reason: reconcileReason, externalMessageId: externalMessageId.trim() || null }) });
      await load(draft.id);
      setReconcileReason("");
      setMessage("Delivery status reconciled by an admin. No message was sent by this action.");
    });
  }

  if (!apiOrigin) return null;
  return <Card className="space-y-5 bg-surface">
    <div><h3 className="font-heading text-lg font-semibold">Email and PDF human review</h3><p className="text-sm text-muted">Every edit creates a new revision. Approval is role-bound to that exact content hash. Review the saved PDF bytes before release.</p></div>
    <div className="flex gap-2"><Input aria-label="Existing draft ID" placeholder="Existing draft ID" value={draftId} onChange={(event) => setDraftId(event.target.value)} /><Button disabled={busy || !draftId.trim()} onClick={() => void run(() => load())} type="button" variant="secondary">Load</Button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="mail-category">Configured route category</Label><Input disabled={Boolean(draft)} id="mail-category" value={category} onChange={(event) => setCategory(event.target.value)} /></div>
      <div><Label htmlFor="mail-recipients">Recipients (comma-separated)</Label><Input id="mail-recipients" value={recipients} onChange={(event) => setRecipients(event.target.value)} /></div>
      <div className="sm:col-span-2"><Label htmlFor="mail-subject">Subject</Label><Input id="mail-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
      <div><Label htmlFor="mail-body">Email body</Label><textarea className="min-h-40 w-full border border-border bg-canvas p-2" id="mail-body" value={body} onChange={(event) => setBody(event.target.value)} /></div>
      <div><Label htmlFor="mail-pdf">PDF text (optional attachment)</Label><textarea className="min-h-40 w-full border border-border bg-canvas p-2" id="mail-pdf" value={pdfText} onChange={(event) => setPdfText(event.target.value)} /></div>
    </div>
    <div className="flex flex-wrap gap-2">{draft ? <Button disabled={busy} onClick={save} type="button" variant="secondary">Save new revision</Button> : <Button disabled={busy || !category.trim()} onClick={create} type="button">Create draft</Button>}</div>
    {draft && <div className="space-y-4 border-t border-border pt-4">
      <p className="text-sm">Draft {draft.id} · revision {draft.revision} · {draft.status} · hash <span className="font-mono">{draft.contentHash}</span></p>
      {dirty && <p className="text-sm text-warning">Unsaved edits are visible above. Save and reload the revision before approving or releasing.</p>}
      <div className="grid gap-3 lg:grid-cols-2"><div className="border border-border bg-canvas p-4"><p className="text-xs font-semibold uppercase text-muted">Saved email preview</p><p className="mt-3 text-xs">To: {draft.content.recipients.join(", ")}</p><p className="mt-3 font-semibold">{draft.content.subject}</p><p className="mt-3 whitespace-pre-wrap text-sm">{draft.content.body}</p></div><div className="border border-border bg-white p-4 text-black"><p className="text-xs font-semibold uppercase text-gray-500">Frozen PDF preview</p>{draft.pdfSha256 ? pdfPreviewUrl ? <iframe className="mt-3 h-96 w-full" src={pdfPreviewUrl} title="Frozen attachment PDF" /> : <p className="mt-3 text-sm">PDF preview unavailable; do not release until reviewed.</p> : <p className="mt-3 text-sm">No PDF attachment</p>}</div></div>
      <p className="text-sm text-muted">Required: {draft.content.requiredRoles.join(", ")} · approved: {draft.approvedRoles.join(", ") || "none"} · sender: {draft.content.senderRole}</p>
      <div className="flex flex-wrap gap-2"><select className="border border-border bg-canvas p-2" value={approvalRole} onChange={(event) => setApprovalRole(event.target.value)}>{draft.content.requiredRoles.map((role) => <option key={role}>{role}</option>)}</select><Button disabled={busy || dirty || !approvalRole} onClick={approve} type="button" variant="secondary">Approve this revision</Button><Button disabled={busy || dirty || (Boolean(draft.pdfSha256) && !pdfPreviewUrl) || !draft.content.requiredRoles.every((role) => draft.approvedRoles.includes(role))} onClick={release} type="button">Release after approvals</Button></div>
      {draft.delivery && <p className="text-sm text-muted">Delivery: {draft.delivery.status}{draft.delivery.claimedAt ? ` · claimed ${new Date(draft.delivery.claimedAt).toLocaleString()}` : ""}{draft.delivery.externalMessageId ? ` · provider ID ${draft.delivery.externalMessageId}` : ""}</p>}
      {admin && draft.delivery && ["claimed", "uncertain", "failed"].includes(draft.delivery.status) && <div className="space-y-2 border-t border-border pt-3"><p className="font-semibold">Admin delivery reconciliation</p><p className="text-sm text-muted">Check the Gmail provider record first. This records the outcome and never retries a send.</p><select aria-label="Reconciled status" className="border border-border bg-canvas p-2" value={reconcileStatus} onChange={(event) => setReconcileStatus(event.target.value as "sent" | "uncertain" | "failed")}><option value="uncertain">Still uncertain</option><option value="sent">Verified sent</option><option value="failed">Verified failed</option></select><Input aria-label="Provider message ID" placeholder="Provider message ID (required for sent)" value={externalMessageId} onChange={(event) => setExternalMessageId(event.target.value)} /><Input aria-label="Reconciliation reason" placeholder="Reason and provider check (at least 10 characters)" value={reconcileReason} onChange={(event) => setReconcileReason(event.target.value)} /><Button disabled={busy || reconcileReason.trim().length < 10 || (reconcileStatus === "sent" && !externalMessageId.trim())} onClick={reconcile} type="button" variant="secondary">Record checked outcome</Button></div>}
    </div>}
    {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
  </Card>;
}
