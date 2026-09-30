"use client";

// Starting a collaborative email. With AI (the creator's own key in the extension) the email is
// written and split for them; without AI they write and split it by hand. Either way the creator
// reviews every part's text, owner, tagged phrases, and questions before it goes out.
// Module map (caller-first):
//   Composer          notes → (AI draft | blank) → editable parts → create
//   ├─ PartEditor     one part: text, owner position, questions, tags
//   │   └─ TagEditor  key phrases (must appear in the text) with their owners
//   └─ usePositions   positions someone holds (only those can own a part)

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { aiComplete, aiStatus } from "@pytorch-ph/domain-client/client-automation";
import { fetchOrgChart } from "../delegation/api";
import { createDraft } from "./api";
import { TAG_LABELS, blankSection, composePrompt, defaultTagOwner, parseComposed, type DraftSection, type PositionOption, type TagLabel } from "./compose";

const AI_MAX_TOKENS = 3000;

function usePositions() {
  const chart = useQuery({ queryKey: ["officer-organization"], queryFn: fetchOrgChart });
  const positions: PositionOption[] = (chart.data?.positions ?? []).filter((position) => position.holders.length > 0).map(({ slug, title }) => ({ slug, title }));
  const mine = chart.data?.positions.find((position) => position.heldByViewer)?.slug ?? positions[0]?.slug ?? "";
  return { positions, mine };
}

export function Composer({ onCreated }: { onCreated: (id: string) => void }) {
  const { positions, mine } = usePositions();
  const ai = useQuery({ queryKey: ["local-ai-status"], queryFn: aiStatus });
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [recipients, setRecipients] = useState("");
  const [mode, setMode] = useState<"ai" | "manual">("manual");
  const [sections, setSections] = useState<DraftSection[]>([]);
  const draftWithAi = useMutation({
    mutationFn: async () => parseComposed(await aiComplete({ ...composePrompt(notes, positions), json: true, maxTokens: AI_MAX_TOKENS }), positions, mine),
    onSuccess: (composed) => { setSections(composed.sections); setSubject((current) => current || composed.subject); setMode("ai"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The AI could not draft this."),
  });
  const create = useMutation({
    mutationFn: () => createDraft({ title, subject, recipients: recipients.split(/[\s,;]+/).filter(Boolean), mode, sections }),
    onSuccess: ({ id }) => { toast.success("Sent to each part's owner for review."); onCreated(id); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The email was not created."),
  });
  const update = (index: number, next: DraftSection) => setSections((current) => current.map((section, at) => (at === index ? next : section)));
  return <Card className="bg-surface">
    <CardHeader><div><CardTitle>New event email</CardTitle><CardDescription>Describe the event; your AI (in your extension) drafts and splits it, or write the parts yourself. Each part goes only to its owner.</CardDescription></div></CardHeader>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="mail-title">Title (for officers)</Label><Input id="mail-title" onChange={(event) => setTitle(event.target.value)} value={title} /></div>
        <div><Label htmlFor="mail-subject">Email subject</Label><Input id="mail-subject" onChange={(event) => setSubject(event.target.value)} value={subject} /></div>
      </div>
      <div><Label htmlFor="mail-recipients">Recipients (comma separated)</Label><Input id="mail-recipients" onChange={(event) => setRecipients(event.target.value)} placeholder="members@pytorch.ph" value={recipients} /></div>
      <div>
        <Label htmlFor="mail-notes">Event notes for the AI</Label>
        <textarea className="mt-1 min-h-24 w-full border border-border bg-elevated p-2 text-sm" id="mail-notes" onChange={(event) => setNotes(event.target.value)} placeholder="What, when, where, who it's for, what you already know and don't know…" value={notes} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={!ai.data?.configured || !notes.trim() || draftWithAi.isPending} onClick={() => draftWithAi.mutate()} size="sm"><Sparkles size={15} />{draftWithAi.isPending ? "Drafting…" : "Draft with my AI"}</Button>
          <Button onClick={() => { setMode(sections.length ? mode : "manual"); setSections((current) => [...current, blankSection(mine)]); }} size="sm" variant="secondary"><Plus size={15} />Add a part by hand</Button>
        </div>
        {!ai.data?.configured && <p className="mt-2 text-xs text-muted">No AI connected: write and split the email by hand (connect one in Settings to draft with AI).</p>}
      </div>
      {sections.map((section, index) => <PartEditor index={index} key={index} onChange={(next) => update(index, next)} onRemove={() => setSections((current) => current.filter((_, at) => at !== index))} positions={positions} section={section} />)}
      <Button disabled={!sections.length || !title.trim() || !subject.trim() || !recipients.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Sending for review…" : "Send parts for review"}</Button>
    </div>
  </Card>;
}

type PartProps = { index: number; section: DraftSection; positions: PositionOption[]; onChange: (next: DraftSection) => void; onRemove: () => void };

function PartEditor({ index, section, positions, onChange, onRemove }: PartProps) {
  return <div className="space-y-2 border border-border bg-elevated p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Part {index + 1}</p>
      <div className="flex items-center gap-2">
        <select aria-label={`Owner of part ${index + 1}`} className="h-9 border border-border bg-surface px-2 text-sm" onChange={(event) => onChange({ ...section, ownerPosition: event.target.value })} value={section.ownerPosition}>
          {positions.map((position) => <option key={position.slug} value={position.slug}>{position.title}</option>)}
        </select>
        <button aria-label={`Remove part ${index + 1}`} className="text-muted hover:text-accent" onClick={onRemove} type="button"><Trash2 size={16} /></button>
      </div>
    </div>
    <textarea aria-label={`Text of part ${index + 1}`} className="min-h-20 w-full border border-border bg-surface p-2 text-sm" onChange={(event) => onChange({ ...section, content: event.target.value })} value={section.content} />
    <TagEditor onChange={(tags) => onChange({ ...section, tags })} positions={positions} section={section} />
    <label className="block text-xs text-muted">Questions for the owner (one per line)
      <textarea className="mt-1 min-h-12 w-full border border-border bg-surface p-2 text-sm" onChange={(event) => onChange({ ...section, questions: event.target.value.split("\n").filter((line) => line.trim()) })} value={section.questions.join("\n")} />
    </label>
  </div>;
}

function TagEditor({ section, positions, onChange }: { section: DraftSection; positions: PositionOption[]; onChange: (tags: DraftSection["tags"]) => void }) {
  const [phrase, setPhrase] = useState("");
  const [label, setLabel] = useState<TagLabel>("date");
  const add = () => { onChange([...section.tags, { label, phrase: phrase.trim(), ownerPosition: defaultTagOwner(label, section.ownerPosition) }]); setPhrase(""); };
  const phraseInText = Boolean(phrase.trim()) && section.content.includes(phrase.trim());
  return <div className="space-y-1 text-xs">
    {section.tags.map((tag, index) => <div className="flex flex-wrap items-center gap-2" key={`${tag.label}-${tag.phrase}-${index}`}>
      <span className="border border-accent/40 bg-accentSoft px-1">{tag.label}: {tag.phrase}</span>
      <select aria-label="Tag owner" className="h-7 border border-border bg-surface px-1" onChange={(event) => onChange(section.tags.map((item, at) => (at === index ? { ...item, ownerPosition: event.target.value } : item)))} value={tag.ownerPosition}>
        {positions.map((position) => <option key={position.slug} value={position.slug}>{position.title}</option>)}
      </select>
      <button className="text-muted underline" onClick={() => onChange(section.tags.filter((_, at) => at !== index))} type="button">remove</button>
    </div>)}
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Tag label" className="h-7 border border-border bg-surface px-1" onChange={(event) => setLabel(event.target.value as TagLabel)} value={label}>{TAG_LABELS.map((item) => <option key={item}>{item}</option>)}</select>
      <input aria-label="Phrase to tag" className="h-7 border border-border bg-surface px-1" onChange={(event) => setPhrase(event.target.value)} placeholder="exact phrase from the text" value={phrase} />
      <button className="font-semibold text-accent disabled:opacity-40" disabled={!phraseInText} onClick={add} type="button">Tag phrase</button>
    </div>
  </div>;
}
