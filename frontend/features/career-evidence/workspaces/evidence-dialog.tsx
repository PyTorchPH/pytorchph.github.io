"use client";

// Edit one achievement: the photo, an optional AI proposal, and the member-owned facts.
// Module map (caller-first):
//   EvidenceDialog          composes media, AI assistant, form fields, proposal and save bar
//   useEvidenceDraft        form, draft and the analyze / apply-proposal / save flows
//     requestEvidenceAnalysis  POST /api/product/evidence/analyze
//     proposedChange           one proposed field value from the AI proposal
//     toApprovedItem           the saved item built from the form
//   EvidenceMedia, AiAssistantPanel, EvidenceFormFields, AiProposalPanel, SaveBar

import Image from "next/image";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Trash2, AlertTriangle, Bot, Check, Sparkles, UserCheck } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Textarea } from "@pytorch-ph/design-system/textarea";
import type { EvidenceItem } from "@pytorch-ph/domain-protocol/career-evidence";
import { evidenceFormSchema, type EvidenceFormValues } from "@pytorch-ph/domain-protocol/career-evidence";
import { collectionOriginLabel, parseSkills, verificationTone } from "./tones";

type EvidenceDialogProps = {
  item: EvidenceItem;
  canWrite: boolean;
  onClose: () => void;
  onSave: (item: EvidenceItem) => Promise<void>;
  /** Deletes a saved achievement (and any points it earned); absent for unsaved drafts. */
  onDelete?: (item: EvidenceItem) => Promise<void>;
};

// Mental model: the form holds the member's facts; AI may propose edits, but only "Save & approve" commits them.
export function EvidenceDialog({ item, canWrite, onClose, onSave, onDelete }: EvidenceDialogProps) {
  const editor = useEvidenceDraft(item, onSave, onClose);
  return (
    <AppDialog
      description="Edit the source-of-truth achievement here. Resume Studio only reads approved facts."
      onClose={onClose}
      title={editor.values.title}
      wide
    >
      <div className="grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
        <div>
          <EvidenceMedia draft={editor.draft} />
          <AiAssistantPanel canWrite={canWrite} editor={editor} />
        </div>
        <div className="space-y-4">
          <EvidenceFormFields form={editor.form} values={editor.values} />
          {editor.proposalVisible && editor.draft.aiProposal && <AiProposalPanel editor={editor} />}
          {editor.saveError && (
            <p aria-live="polite" className="text-sm text-danger">
              {editor.saveError}
            </p>
          )}
          <SaveBar canWrite={canWrite} editor={editor} onClose={onClose} onDelete={onDelete && (() => onDelete(item))} />
        </div>
      </div>
    </AppDialog>
  );
}

// Mental model: the draft mirrors the item plus AI state; the form mirrors the editable fields.
function useEvidenceDraft(item: EvidenceItem, onSave: (item: EvidenceItem) => Promise<void>, onClose: () => void) {
  const [draft, setDraft] = useState(item);
  const [proposalVisible, setProposalVisible] = useState(item.verificationState === "ai_proposed");
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

  const analyze = async () => {
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const proposal = await requestEvidenceAnalysis(draft.id, values);
      setDraft((current) => ({ ...current, aiProposal: proposal, verificationState: "ai_proposed" }));
      setProposalVisible(true);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "AI analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const applyProposal = () => {
    const description = proposedChange(draft, "Description");
    const skills = proposedChange(draft, "Skills");
    if (description) form.setValue("description", description, { shouldValidate: true });
    if (skills) form.setValue("skillsText", skills, { shouldValidate: true });
    setDraft((current) => ({ ...current, verificationState: "source_matched" }));
    setProposalVisible(false);
  };

  const save = form.handleSubmit(async (formValues) => {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(toApprovedItem(draft, formValues));
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save evidence.");
    } finally {
      setSaving(false);
    }
  });

  return { form, values, draft, proposalVisible, consented, setConsented, analyzing, analysisError, saveError, saving, analyze, applyProposal, save };
}

type EvidenceEditor = ReturnType<typeof useEvidenceDraft>;

async function requestEvidenceAnalysis(evidenceId: string, values: EvidenceFormValues): Promise<EvidenceItem["aiProposal"]> {
  const response = await fetch(
    "/api/product/evidence/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consent: true,
        evidenceId,
        current: {
          title: values.title,
          description: values.description,
          skills: parseSkills(values.skillsText),
        },
      }),
    },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "AI analysis failed.");
  return payload.proposal;
}

const proposedChange = (draft: EvidenceItem, field: string) =>
  draft.aiProposal?.changes.find((changeItem) => changeItem.field === field)?.after;

const toApprovedItem = (draft: EvidenceItem, formValues: EvidenceFormValues): EvidenceItem => ({
  ...draft,
  evidenceKind: formValues.evidenceKind || "project",
  title: formValues.title,
  organization: formValues.organization,
  role: formValues.evidenceKind === "experience" ? formValues.role : "",
  dateLabel: formValues.dateLabel,
  description: formValues.description,
  skills: parseSkills(formValues.skillsText),
  verificationState: "user_verified",
});

function EvidenceMedia({ draft }: { draft: EvidenceItem }) {
  return (
    <>
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
        <Badge>{collectionOriginLabel(draft)}</Badge>
        {draft.confidence && (
          <Badge>{draft.confidence}% source match</Badge>
        )}
      </div>
    </>
  );
}

function AiAssistantPanel({ editor, canWrite }: { editor: EvidenceEditor; canWrite: boolean }) {
  return (
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
          checked={editor.consented}
          className="mt-0.5"
          onChange={(event) => editor.setConsented(event.target.checked)}
          type="checkbox"
        />
        I approve analysis of this selected demo evidence.
      </label>
      <Button
        className="mt-4 w-full"
        disabled={!canWrite || !editor.consented || editor.analyzing}
        onClick={editor.analyze}
        size="sm"
      >
        <Bot size={15} />
        {editor.analyzing ? "Analyzing…" : "Analyze selected evidence"}
      </Button>
      {editor.analysisError && (
        <p className="mt-3 text-xs leading-5 text-danger">
          {editor.analysisError}
        </p>
      )}
    </div>
  );
}

function EvidenceFormFields({ form, values }: { form: UseFormReturn<EvidenceFormValues>; values: EvidenceFormValues }) {
  return (
    <>
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
    </>
  );
}

function AiProposalPanel({ editor }: { editor: EvidenceEditor }) {
  const proposal = editor.draft.aiProposal;
  if (!proposal) return null;
  return (
    <div className="rounded-xl border border-accent/30 bg-accentSoft p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">AI proposal</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {proposal.summary}
          </p>
        </div>
        <Badge variant="orange">Review</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {proposal.changes.map((change) => (
          <div
            className="rounded-lg border border-border bg-surface p-3"
            key={change.field}
          >
            <p className="text-xs font-semibold">{change.field}</p>
            <p className="mt-2 text-xs text-danger line-through">
              {change.before}
            </p>
            <p className="mt-1 text-xs text-success">
              {change.after}
            </p>
          </div>
        ))}
      </div>
      {proposal.warnings.map((warning) => (
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
        onClick={editor.applyProposal}
        size="sm"
      >
        <Check size={15} />
        Apply selected changes
      </Button>
    </div>
  );
}

type SaveBarProps = { editor: EvidenceEditor; canWrite: boolean; onClose: () => void; onDelete?: () => Promise<void> };

function SaveBar({ editor, canWrite, onClose, onDelete }: SaveBarProps) {
  const [deleting, setDeleting] = useState(false);
  // Deleting is final: the achievement leaves the gallery and any points it earned are taken back.
  const remove = async () => {
    if (!onDelete || !confirm("Delete this achievement? Any points it earned are taken back. This cannot be undone.")) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      {onDelete && <Button className="mr-auto" disabled={!canWrite || deleting || editor.saving} onClick={() => void remove()} variant="ghost">
        <Trash2 size={16} />{deleting ? "Deleting…" : "Delete"}
      </Button>}
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button
        disabled={!canWrite || editor.saving}
        onClick={editor.save}
      >
        <UserCheck size={16} />
        {editor.saving ? "Saving…" : "Save & approve"}
      </Button>
    </div>
  );
}
