import type { GeneratedDocument } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * Downstream actions that fire AFTER approval. Each is HITL-gated: the AI prepares the payload,
 * but a human must confirm before it actually sends/posts.
 */

export interface EmailDraft {
  to: string[]; // resolved recipients — "kung sino-sino ang ee-email"
  subject: string;
  body: string;
  relatedDocument: GeneratedDocument;
}

export interface EmailSender {
  /** Prepare a draft + resolve recipients. Does NOT send. */
  prepare(document: GeneratedDocument): Promise<EmailDraft>;
  /** Send ONLY after a human approved this exact draft. */
  send(draft: EmailDraft, confirmedByUserId: string): Promise<void>;
}

export interface PostDraft {
  pageId: string;
  message: string;
  mediaUrls?: string[];
  relatedDocument?: GeneratedDocument;
}

export interface Poster {
  /** Prepare a Facebook Page post draft. Does NOT publish. */
  prepare(input: { message: string; mediaUrls?: string[] }): Promise<PostDraft>;
  /** Publish ONLY after a human approved this exact draft. */
  publish(draft: PostDraft, confirmedByUserId: string): Promise<void>;
}

/** Stub — needs an email surface (Gmail API / org mail) + recipient resolution. */
export class HitlEmailSender implements EmailSender {
  async prepare(_document: GeneratedDocument): Promise<EmailDraft> {
    throw new Error("not implemented: HitlEmailSender.prepare — needs email surface + recipient rules");
  }
  async send(_draft: EmailDraft, _confirmedByUserId: string): Promise<void> {
    throw new Error("not implemented: HitlEmailSender.send — gated on human confirmation");
  }
}

/** Stub — needs Facebook Page Graph API access + page token. */
export class HitlPoster implements Poster {
  async prepare(_input: { message: string; mediaUrls?: string[] }): Promise<PostDraft> {
    throw new Error("not implemented: HitlPoster.prepare — needs FB Page API token");
  }
  async publish(_draft: PostDraft, _confirmedByUserId: string): Promise<void> {
    throw new Error("not implemented: HitlPoster.publish — gated on human confirmation");
  }
}
