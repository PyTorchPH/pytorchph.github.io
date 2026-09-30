"use client";

// The Email Drafts page. Every officer sees only their own parts of an email (the server decides):
// their paragraphs to confirm or edit, their tagged phrases, and questions to answer. The creator
// sees everything; the Secretariat, the President, and the sender see the full email on their turn.
// Module map (caller-first):
//   CollabMailView    list of drafts I'm part of · new draft · the open draft
//   └─ DraftDetail    one draft for the current viewer
//       ├─ MyPart     confirm unchanged (hit) or save an edit (owner: approved; others: sent back)
//       ├─ MyPhrase   set or confirm a tagged phrase inside someone else's paragraph
//       ├─ Question   answer missing information
//       └─ ChainPanel full email, Approve (Secretariat, President) or Send (Communications)
//   useDraftAction    run an action, refresh the draft and the list, toast the outcome

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { DataUnavailable } from "@pytorch-ph/design-system/data-unavailable";
import {
  answerQuestion, approveStep, confirmSection, editSection, fetchDraft, listDrafts, sendDraft, setTag,
  type DraftView, type ViewQuestion, type ViewSection, type ViewTag,
} from "./api";
import { Composer } from "./render-composer";

const STAGE_LABELS: Record<string, string> = { in_review: "Parts in review", secretariat: "With the Secretariat", president: "With the President", sending: "Ready to send", queued: "Sent to delivery" };
const STATE_TONE: Record<string, "success" | "warning" | "default"> = { confirmed: "success", changed: "warning", pending: "default" };

export function CollabMailView() {
  const drafts = useQuery({ queryKey: ["collab-mail"], queryFn: listDrafts });
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  return <div className="space-y-6">
    <section className="page-hero">
      <h1 className="text-3xl font-extrabold tracking-[-0.02em]">Email drafts</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted">Event emails reviewed part by part: each officer sees only the paragraphs and facts they own. When every part is confirmed, the email goes to the Secretariat, then the President, then Communications sends it.</p>
      <Button className="mt-4" onClick={() => setComposing(!composing)} size="sm" variant="secondary">{composing ? "Close the new email" : "New event email"}</Button>
    </section>
    {composing && <Composer onCreated={(id) => { setComposing(false); setOpen(id); void drafts.refetch(); }} />}
    <Card className="bg-surface">
      <CardHeader><div><CardTitle>Your emails</CardTitle><CardDescription>Emails you started, own a part of, or need to approve.</CardDescription></div></CardHeader>
      <DataUnavailable label={drafts.isError ? "Data unavailable" : "Loading data"} unavailable={!drafts.data}>
        {drafts.data?.length ? <ul className="divide-y divide-border">
          {drafts.data.map((draft) => <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={draft.id}>
            <button className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => setOpen(draft.id)} type="button">{draft.title}</button>
            <span className="flex items-center gap-2 text-xs">
              {draft.openTasks > 0 && <Badge variant="warning">{draft.openTasks} for you</Badge>}
              {draft.myTurn && <Badge variant="warning">Your approval</Badge>}
              <Badge>{STAGE_LABELS[draft.stage] ?? draft.stage}</Badge>
            </span>
          </li>)}
        </ul> : <p className="py-6 text-center text-sm text-muted">No emails need you yet.</p>}
      </DataUnavailable>
    </Card>
    {open && <DraftDetail id={open} />}
  </div>;
}

function DraftDetail({ id }: { id: string }) {
  const draft = useQuery({ queryKey: ["collab-mail", id], queryFn: () => fetchDraft(id) });
  const view = draft.data;
  return <Card className="bg-surface">
    <DataUnavailable label={draft.isError ? "Data unavailable" : "Loading data"} unavailable={!view}>
      {view && <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-lg font-bold">{view.title}</p><p className="text-xs text-muted">{view.mode === "ai" ? "Drafted with AI" : "Written by hand"} · {STAGE_LABELS[view.stage] ?? view.stage}</p></div></header>
        <ol aria-label="Outline" className="flex flex-wrap gap-2 text-xs">{view.outline.map((part) => <li className="border border-border px-2 py-1" key={part.ord}>Part {part.ord + 1}: {part.owner} <Badge variant={STATE_TONE[part.state]}>{part.state}</Badge></li>)}</ol>
        {view.sections.map((section) => <MyPart draft={view} key={section.id} section={section} />)}
        {view.tags.map((tag) => <MyPhrase draftId={view.id} key={tag.id} tag={tag} />)}
        {!view.sections.length && !view.tags.length && !view.email && <p className="text-sm text-muted">Nothing here needs you right now.</p>}
        {view.email && <ChainPanel draft={view} />}
      </div>}
    </DataUnavailable>
  </Card>;
}

function MyPart({ draft, section }: { draft: DraftView; section: ViewSection }) {
  const [text, setText] = useState(section.content);
  const confirm = useDraftAction(draft.id, () => confirmSection(draft.id, section.id, section.contentHash), "Confirmed as written.");
  const save = useDraftAction(draft.id, () => editSection(draft.id, section.id, section.contentHash, text), section.isMine ? "Saved and approved." : "Saved; the owner will review your change.");
  const locked = draft.stage === "queued";
  return <div className="space-y-2 border border-border bg-elevated p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Part {section.ord + 1} · {section.owner}</p><Badge variant={STATE_TONE[section.state]}>{section.state}</Badge></div>
    <textarea aria-label={`Part ${section.ord + 1} text`} className="min-h-24 w-full border border-border bg-surface p-2 text-sm" disabled={locked} onChange={(event) => setText(event.target.value)} value={text} />
    {section.tags.length > 0 && <p className="text-xs text-muted">Facts owned by others here: {section.tags.map((tag) => `${tag.label} "${tag.phrase}" (${tag.owner}, ${tag.state})`).join("; ")}</p>}
    {section.questions.map((question) => <Question draftId={draft.id} key={question.id} locked={locked} question={question} />)}
    <div className="flex flex-wrap gap-2">
      {section.isMine && text === section.content && <Button disabled={locked || confirm.isPending || section.state === "confirmed"} onClick={() => confirm.mutate()} size="sm">Looks right</Button>}
      {text !== section.content && <Button disabled={locked || save.isPending} onClick={() => save.mutate()} size="sm">{section.isMine ? "Save (approves it)" : "Save change (owner reviews)"}</Button>}
    </div>
  </div>;
}

function MyPhrase({ draftId, tag }: { draftId: string; tag: ViewTag }) {
  const [phrase, setPhrase] = useState(tag.phrase);
  const save = useDraftAction(draftId, () => setTag(draftId, tag.id, phrase), "Your fact is set.");
  return <div className="flex flex-wrap items-center gap-2 border border-border bg-elevated p-3 text-sm">
    <span className="font-semibold capitalize">{tag.label}</span><span className="text-xs text-muted">in part {Number(tag.sectionOrd) + 1}</span>
    <input aria-label={`${tag.label} phrase`} className="h-9 flex-1 border border-border bg-surface px-2" onChange={(event) => setPhrase(event.target.value)} value={phrase} />
    <Badge variant={STATE_TONE[tag.state]}>{tag.state}</Badge>
    <Button disabled={save.isPending || (tag.state === "confirmed" && phrase === tag.phrase)} onClick={() => save.mutate()} size="sm">{phrase === tag.phrase ? "Looks right" : "Set"}</Button>
  </div>;
}

function Question({ draftId, question, locked }: { draftId: string; question: ViewQuestion; locked: boolean }) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  const save = useDraftAction(draftId, () => answerQuestion(draftId, question.id, answer), "Answer saved.");
  return <label className="block text-xs"><span className="font-semibold">{question.prompt}</span>
    <span className="mt-1 flex gap-2"><input className="h-8 flex-1 border border-border bg-surface px-2 text-sm" disabled={locked} onChange={(event) => setAnswer(event.target.value)} value={answer} />
      <Button disabled={locked || !answer.trim() || answer === question.answer || save.isPending} onClick={() => save.mutate()} size="sm" variant="secondary">Answer</Button></span>
  </label>;
}

function ChainPanel({ draft }: { draft: DraftView }) {
  const email = draft.email!;
  const approve = useDraftAction(draft.id, () => approveStep(draft.id, email.assembledHash), "Approved.");
  const send = useDraftAction(draft.id, () => sendDraft(draft.id, email.assembledHash), "Handed to mail delivery.");
  return <div className="space-y-2 border border-accent/40 p-3">
    <p className="text-sm font-semibold">Full email</p>
    <p className="text-xs text-muted">To: {email.recipients.join(", ")} · Subject: {email.subject}</p>
    <pre className="whitespace-pre-wrap bg-elevated p-3 text-sm">{email.body}</pre>
    {draft.myTurn && (draft.stage === "sending"
      ? <Button disabled={send.isPending} onClick={() => confirm("Send this exact email?") && send.mutate()} size="sm">Send email</Button>
      : <Button disabled={approve.isPending} onClick={() => approve.mutate()} size="sm">Approve this version</Button>)}
  </div>;
}

function useDraftAction(draftId: string, run: () => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["collab-mail"] }); toast.success(success); },
    onError: async (error) => { await queryClient.invalidateQueries({ queryKey: ["collab-mail", draftId] }); toast.error(error instanceof Error ? error.message : "Not saved."); },
  });
}
