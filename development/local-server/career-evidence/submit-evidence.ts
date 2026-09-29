import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { evidenceSubmissionEnvelopeSchema, type EvidenceSubmissionEnvelope } from "@pytorch-ph/domain-protocol/career-evidence";
import { localDemoDatabasePath } from "./read-demo-state";
import { configuredProductProvider } from "./select-repository";

export function evidenceEnvelopeHash(value: Pick<EvidenceSubmissionEnvelope, "source" | "pageUrl" | "items">) {
  return `sha256:${createHash("sha256").update(JSON.stringify({ source: value.source, pageUrl: value.pageUrl, items: value.items })).digest("hex")}`;
}

export async function submitEvidenceEnvelope(userId: string, input: unknown) {
  if (!userId) throw new Error("Authentication required.");
  const value = evidenceSubmissionEnvelopeSchema.parse(input);
  if (evidenceEnvelopeHash(value) !== value.contentHash) throw new Error("Evidence content hash mismatch.");
  configuredProductProvider();
  const db = new DatabaseSync(localDemoDatabasePath());
  try {
    db.exec("CREATE TABLE IF NOT EXISTS evidence_submissions_demo (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,content_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,content_hash)) STRICT");
    db.exec("CREATE TABLE IF NOT EXISTS evidence_claims_demo (id TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT");
    const existing = db.prepare("SELECT id FROM evidence_submissions_demo WHERE user_id=? AND content_hash=?").get(userId, value.contentHash) as { id: string } | undefined;
    if (existing) return { submissionId: existing.id, claimIds: [], duplicate: true };
    const id = randomUUID();
    const now = new Date().toISOString();
    const claimIds = value.items.map(() => randomUUID());
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO evidence_submissions_demo VALUES (?,?,?,?,?)").run(id, userId, value.contentHash, JSON.stringify(value), now);
    const insertClaim = db.prepare("INSERT INTO evidence_claims_demo VALUES (?,?)");
    value.items.forEach((item, index) => {
      const contentHash = `sha256:${createHash("sha256").update(`${value.contentHash}:${item.sourceUrl}:${item.title}`).digest("hex")}`;
      insertClaim.run(claimIds[index], JSON.stringify({
        id: claimIds[index], memberLabel: `Member ${userId.slice(0, 8).toUpperCase()}`, title: item.title,
        source: value.source, provenance: value.origin === "manual" ? "manual_pending" : "scraped_pending",
        department: item.department, sourceUrl: item.sourceUrl, contentHash, points: 0,
        origin: value.origin, proposedLevel: item.proposedLevel, normalizedPayload: item,
        warnings: value.warnings, riskSignals: [], decisionReason: null, updatedAt: now,
      }));
    });
    db.exec("COMMIT");
    return { submissionId: id, claimIds, duplicate: false };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    throw error;
  } finally { db.close(); }
}
