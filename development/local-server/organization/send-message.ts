export type MailDraft = { to: string[]; subject: string; body: string; revisionHash: string };
export type MailReceipt = { provider: "copy_export" | "gmail"; messageId: string };
export type MailMode = MailReceipt["provider"];

export interface MailAdapter {
  readonly mode: MailMode;
  deliverApproved(draft: MailDraft, idempotencyKey: string): Promise<MailReceipt>;
}

class CopyExportAdapter implements MailAdapter {
  readonly mode = "copy_export" as const;
  async deliverApproved(_draft: MailDraft, idempotencyKey: string): Promise<MailReceipt> {
    return { provider: this.mode, messageId: `export:${idempotencyKey}` };
  }
}

class GmailAdapter implements MailAdapter {
  readonly mode = "gmail" as const;
  async deliverApproved(draft: MailDraft, idempotencyKey: string): Promise<MailReceipt> {
    const token = process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN;
    const allowedRecipient = process.env.PYTORCH_PH_SADO_EMAIL?.trim().toLowerCase();
    if (!token || !allowedRecipient) throw new Error("Gmail delivery is not fully configured. Copy/export mode remains available.");
    if (draft.to.length !== 1 || draft.to[0].trim().toLowerCase() !== allowedRecipient) throw new Error("The recipient is not in the configured SADO allowlist.");
    const raw = Buffer.from(
      `To: ${draft.to[0]}\r\nSubject: ${draft.subject}\r\nMessage-ID: <${idempotencyKey}@pytorch-ph.local>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${draft.body}`,
    ).toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const payload = await response.json() as { id?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) throw new Error(payload.error?.message || "Gmail rejected the approved message.");
    return { provider: this.mode, messageId: payload.id };
  }
}

export function configuredMailAdapter(): MailAdapter {
  const mode = process.env.PYTORCH_PH_EVENT_MAIL_MODE || "copy_export";
  if (mode === "copy_export") return new CopyExportAdapter();
  if (mode === "gmail") return new GmailAdapter();
  throw new Error("PYTORCH_PH_EVENT_MAIL_MODE must be copy_export or gmail.");
}
