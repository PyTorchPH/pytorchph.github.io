// Network calls for collaborative event emails (officer-only, through the portal gateway).
// Module map:
//   DraftSummary / DraftView / ViewSection / ViewTag   response shapes (server-scoped per viewer)
//   listDrafts / fetchDraft / createDraft              list, one draft, new draft
//   editSection / confirmSection / setTag / answer     part owners' actions (hash-checked)
//   approveStep / sendDraft                            Secretariat → President, then send

import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { DraftSection } from "./compose";

export type DraftSummary = { id: string; title: string; stage: string; openTasks: number; myTurn: boolean; isCreator: boolean; updatedAt: string };
export type ViewTag = { id: string; label: string; phrase: string; owner?: string; state: string; sectionOrd?: number };
export type ViewQuestion = { id: string; prompt: string; answer: string | null };
export type ViewSection = { id: string; ord: number; owner: string; isMine: boolean; state: string; content: string; contentHash: string; tags: ViewTag[]; questions: ViewQuestion[] };
export type DraftView = {
  id: string; title: string; subject: string; mode: string; stage: string; isCreator: boolean; myTurn: boolean; turnPosition: string | null;
  outline: Array<{ ord: number; owner: string; state: string }>; sections: ViewSection[]; tags: ViewTag[];
  email: { subject: string; recipients: string[]; body: string; assembledHash: string } | null;
};

const BASE = "/api/officer/mail-collab";
const send = <T>(path: string, method: string, body: unknown) =>
  fetchJson<T>(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const listDrafts = () => fetchJson<DraftSummary[]>(BASE, { cache: "no-store" });
export const fetchDraft = (id: string) => fetchJson<DraftView>(`${BASE}/${encodeURIComponent(id)}`, { cache: "no-store" });
export const createDraft = (draft: { title: string; subject: string; recipients: string[]; mode: "ai" | "manual"; sections: DraftSection[] }) => send<{ id: string }>("", "POST", draft);
export const editSection = (draft: string, section: string, basedOnHash: string, content: string) => send<{ state: string }>(`/${draft}/sections/${section}`, "PUT", { basedOnHash, content });
export const confirmSection = (draft: string, section: string, basedOnHash: string) => send(`/${draft}/sections/${section}/confirm`, "POST", { basedOnHash });
export const setTag = (draft: string, tag: string, phrase: string) => send(`/${draft}/tags/${tag}`, "PUT", { phrase });
export const answerQuestion = (draft: string, question: string, answer: string) => send(`/${draft}/questions/${question}`, "POST", { answer });
export const approveStep = (draft: string, assembledHash: string) => send(`/${draft}/approve`, "POST", { assembledHash });
export const sendDraft = (draft: string, assembledHash: string) => send(`/${draft}/send`, "POST", { assembledHash });
