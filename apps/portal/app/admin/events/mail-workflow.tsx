"use client";

import { useState } from "react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";

type Draft = {
  id: string;
  revision: number;
  status: string;
  contentHash: string;
  approvedRoles: string[];
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
  const [approvalRole, setApprovalRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = Boolean(draft) && (recipients !== draft!.content.recipients.join(", ") || subject !== draft!.content.subject || body !== draft!.content.body || pdfText !== (draft!.content.pdfText || ""));

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

  if (!apiOrigin) return null;
  return <Card className="space-y-5 bg-surface">
    <div><h3 className="font-heading text-lg font-semibold">Email and PDF human review</h3><p className="text-sm text-muted">Every edit creates a new revision. Approval is role-bound to that exact content hash. PDF-bearing drafts remain unreleasable until server rendering is configured.</p></div>
    <div className="flex gap-2"><Input aria-label="Existing draft ID" placeholder="Existing draft ID" value={draftId} onChange={(event) => setDraftId(event.target.value)} /><Button disabled={busy || !draftId.trim()} onClick={() => void run(() => load())} type="button" variant="secondary">Load</Button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="mail-category">Configured route category</Label><Input disabled={Boolean(draft)} id="mail-category" value={category} onChange={(event) => setCategory(event.target.value)} /></div>
      <div><Label htmlFor="mail-recipients">Recipients (comma-separated)</Label><Input id="mail-recipients" value={recipients} onChange={(event) => setRecipients(event.target.value)} /></div>
      <div className="sm:col-span-2"><Label htmlFor="mail-subject">Subject</Label><Input id="mail-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
      <div><Label htmlFor="mail-body">Email body</Label><textarea className="min-h-40 w-full border border-border bg-canvas p-2" id="mail-body" value={body} onChange={(event) => setBody(event.target.value)} /></div>
      <div><Label htmlFor="mail-pdf">PDF text (optional preview)</Label><textarea className="min-h-40 w-full border border-border bg-canvas p-2" id="mail-pdf" value={pdfText} onChange={(event) => setPdfText(event.target.value)} /></div>
    </div>
    <div className="flex flex-wrap gap-2">{draft ? <Button disabled={busy} onClick={save} type="button" variant="secondary">Save new revision</Button> : <Button disabled={busy || !category.trim()} onClick={create} type="button">Create draft</Button>}</div>
    {draft && <div className="space-y-4 border-t border-border pt-4">
      <p className="text-sm">Draft {draft.id} · revision {draft.revision} · {draft.status} · hash <span className="font-mono">{draft.contentHash}</span></p>
      {dirty && <p className="text-sm text-warning">Unsaved edits are visible above. Save and reload the revision before approving or releasing.</p>}
      <div className="grid gap-3 lg:grid-cols-2"><div className="border border-border bg-canvas p-4"><p className="text-xs font-semibold uppercase text-muted">Saved email preview</p><p className="mt-3 text-xs">To: {draft.content.recipients.join(", ")}</p><p className="mt-3 font-semibold">{draft.content.subject}</p><p className="mt-3 whitespace-pre-wrap text-sm">{draft.content.body}</p></div><div className="border border-border bg-white p-4 text-black"><p className="text-xs font-semibold uppercase text-gray-500">Saved PDF content preview</p><p className="mt-3 whitespace-pre-wrap text-sm">{draft.content.pdfText || "No PDF content"}</p></div></div>
      <p className="text-sm text-muted">Required: {draft.content.requiredRoles.join(", ")} · approved: {draft.approvedRoles.join(", ") || "none"} · sender: {draft.content.senderRole}</p>
      <div className="flex flex-wrap gap-2"><select className="border border-border bg-canvas p-2" value={approvalRole} onChange={(event) => setApprovalRole(event.target.value)}>{draft.content.requiredRoles.map((role) => <option key={role}>{role}</option>)}</select><Button disabled={busy || dirty || !approvalRole} onClick={approve} type="button" variant="secondary">Approve this revision</Button><Button disabled={busy || dirty || Boolean(draft.content.pdfText) || !draft.content.requiredRoles.every((role) => draft.approvedRoles.includes(role))} onClick={release} type="button">Release after approvals</Button></div>
    </div>}
    {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
  </Card>;
}
