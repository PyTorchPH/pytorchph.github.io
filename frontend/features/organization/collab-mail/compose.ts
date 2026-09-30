// Building a collaborative email draft: the AI (the creator's own key, via the extension) proposes
// the split, owners, key-phrase tags, and questions; the creator confirms or changes it. Without AI
// the creator does the same by hand. The AI reply is untrusted and checked before use.
//
// Module map (caller-first):
//   composePrompt      event notes + positions → prompt for {subject, sections[]}
//   parseComposed      reply → DraftSection[] (unknown positions dropped, tags must be in the text)
//   defaultTagOwner    date/time/venue → COO, budget → Treasurer, speakers → Learning Programs, …
//   blankSection       an empty section for manual mode

export type TagLabel = "date" | "time" | "venue" | "budget" | "speaker" | "program" | "partner" | "link" | "contact" | "other";
export const TAG_LABELS: TagLabel[] = ["date", "time", "venue", "budget", "speaker", "program", "partner", "link", "contact", "other"];

export type DraftTag = { label: TagLabel; phrase: string; ownerPosition: string };
export type DraftSection = { content: string; ownerPosition: string; questions: string[]; tags: DraftTag[] };
export type PositionOption = { slug: string; title: string };
export type Composed = { subject: string; sections: DraftSection[] };

// Who answers for each kind of fact by default (the creator can change any of them).
const TAG_OWNERS: Record<TagLabel, string> = {
  date: "coo", time: "coo", venue: "coo", budget: "treasurer", speaker: "head_learning_programs",
  program: "head_learning_programs", partner: "head_partnerships_outreach", link: "communications_officer",
  contact: "communications_officer", other: "",
};

export const defaultTagOwner = (label: TagLabel, fallback: string) => TAG_OWNERS[label] || fallback;

export const blankSection = (ownerPosition: string): DraftSection => ({ content: "", ownerPosition, questions: [], tags: [] });

export function composePrompt(notes: string, positions: PositionOption[]) {
  return {
    system: "You draft event emails for PyTorch Philippines officers. Answer with JSON only. Never invent facts: ask questions instead.",
    prompt: `Event notes from the officer:
${notes}

Positions (slug: title):
${positions.map((position) => `${position.slug}: ${position.title}`).join("\n")}

Write a friendly announcement email split into 3-8 short paragraphs. Give each paragraph the position that knows its facts best.
Tag key phrases that appear verbatim in a paragraph: label one of ${TAG_LABELS.join(", ")}.
Where a fact is unknown (budget, venue, speakers, dates), write a clear placeholder and add a question for that paragraph's owner.
Return {"subject": string, "sections": [{"content": string, "ownerPosition": string, "questions": string[], "tags": [{"label": string, "phrase": string}]}]}.`,
  };
}

export function parseComposed(reply: string, positions: PositionOption[], creatorPosition: string): Composed {
  const known = new Set(positions.map((position) => position.slug));
  let parsed: { subject?: unknown; sections?: unknown };
  try {
    parsed = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The AI reply was not valid JSON. Try again.");
  }
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error("The AI reply had no paragraphs. Try again.");
  const sections = (parsed.sections as Array<Record<string, unknown>>).map((section) => {
    const content = plain(section.content, 4000);
    const ownerPosition = known.has(String(section.ownerPosition)) ? String(section.ownerPosition) : creatorPosition;
    const tags = (Array.isArray(section.tags) ? section.tags : []).flatMap((tag: Record<string, unknown>) => {
      const label = TAG_LABELS.includes(tag?.label as TagLabel) ? tag.label as TagLabel : "other";
      const phrase = plain(tag?.phrase, 300);
      return phrase && content.includes(phrase) ? [{ label, phrase, ownerPosition: defaultTagOwner(label, ownerPosition) }] : [];
    });
    const questions = (Array.isArray(section.questions) ? section.questions : []).map((question) => plain(question, 300)).filter(Boolean);
    return { content, ownerPosition, tags, questions };
  }).filter((section) => section.content);
  return { subject: plain(parsed.subject, 200), sections };
}

// Plain text only, like the server: no control characters, trimmed, bounded.
const plain = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max) : "";
