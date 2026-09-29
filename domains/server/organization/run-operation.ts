import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ViewerContext } from "@pytorch-ph/domain-server/identity";
import {
  eventPackageSchema,
  evidenceAppealDecisionSchema,
  evidenceAppealRequestSchema,
  requiredDepartmentsByCategory,
  type Department,
  type EvidenceClaim,
  type EvidenceReview,
  type EvidenceIntegrityCase,
  type OfficerEvidenceAppeal,
  type EventAction,
  type EventMailDraft,
  type EventPackage,
  type ExternalEvent,
} from "@pytorch-ph/domain-protocol/organization";
import { localDemoDatabasePath } from "@pytorch-ph/domain-server/career-evidence";
import { configuredMailAdapter } from "./send-message";

function openOperationsDatabase() {
  const db = new DatabaseSync(localDemoDatabasePath());
  db.exec(`CREATE TABLE IF NOT EXISTS evidence_claims_demo (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS external_events_demo (id TEXT PRIMARY KEY, submitted_by TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, interested INTEGER NOT NULL DEFAULT 0, interest_count INTEGER NOT NULL DEFAULT 0, approvals INTEGER NOT NULL DEFAULT 0, approval_total INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS external_event_interests_demo (event_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
    CREATE TABLE IF NOT EXISTS event_mail_demo (event_id TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, revision_hash TEXT NOT NULL, approved_by TEXT, sent_at TEXT);`);
  const eventColumns = new Set((db.prepare("PRAGMA table_info(external_events_demo)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, definition] of [
    ["revision", "INTEGER NOT NULL DEFAULT 1"],
    ["required_departments", "TEXT NOT NULL DEFAULT '[]'"],
    ["approved_departments", "TEXT NOT NULL DEFAULT '[]'"],
    ["sado_reference", "TEXT"],
  ] as const) if (!eventColumns.has(name)) db.exec(`ALTER TABLE external_events_demo ADD COLUMN ${name} ${definition}`);
  const mailColumns = new Set((db.prepare("PRAGMA table_info(event_mail_demo)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, definition] of [
    ["delivery_mode", "TEXT NOT NULL DEFAULT 'copy_export'"],
    ["delivery_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["provider", "TEXT"],
    ["provider_message_id", "TEXT"],
    ["idempotency_key", "TEXT"],
  ] as const) if (!mailColumns.has(name)) db.exec(`ALTER TABLE event_mail_demo ADD COLUMN ${name} ${definition}`);
  const count = Number((db.prepare("SELECT count(*) count FROM evidence_claims_demo").get() as { count: number }).count);
  if (!count) {
    const claims: EvidenceClaim[] = [
      { id: "claim-fb-01", memberLabel: "Member #7A82F", title: "PyTorch workshop facilitation", source: "facebook", provenance: "scraped_verified", department: "academics", sourceUrl: "https://facebook.com/example/posts/verified", contentHash: "sha256:8f31a2", points: 250, updatedAt: new Date().toISOString() },
      { id: "claim-manual-02", memberLabel: "Member #4C19A", title: "Local AI study group lead", source: "manual", provenance: "manual_pending", department: "academics", sourceUrl: null, contentHash: "sha256:1d9cb4", points: 0, updatedAt: new Date().toISOString() },
      { id: "claim-li-03", memberLabel: "Member #91B2E", title: "Competition finalist", source: "linkedin", provenance: "scraped_pending", department: "external_relations", sourceUrl: "https://linkedin.com/feed/update/example", contentHash: "sha256:73ab9e", points: 0, updatedAt: new Date().toISOString() },
    ];
    const insert = db.prepare("INSERT INTO evidence_claims_demo VALUES (?,?)");
    claims.forEach((claim) => insert.run(claim.id, JSON.stringify(claim)));
  }
  return db;
}

function assertOfficer(viewer: ViewerContext) {
  if (!viewer.isOfficer || viewer.audience !== "officer") throw new Error("Officer authorization required.");
}

export async function readEvidenceClaims(viewer: ViewerContext): Promise<EvidenceClaim[]> {
  assertOfficer(viewer);
  const db = openOperationsDatabase();
  try { return db.prepare("SELECT payload FROM evidence_claims_demo").all().map((row) => JSON.parse(String(row.payload))); }
  finally { db.close(); }
}

export async function reviewEvidenceClaim(viewer: ViewerContext, id: string, review: EvidenceReview): Promise<EvidenceClaim> {
  assertOfficer(viewer);
  const db = openOperationsDatabase();
  try {
    const row = db.prepare("SELECT payload FROM evidence_claims_demo WHERE id=?").get(id) as { payload: string } | undefined;
    if (!row) throw new Error("Claim not found.");
    const claim = JSON.parse(row.payload) as EvidenceClaim;
    if (!["manual_pending", "scraped_pending", "disputed"].includes(claim.provenance)) throw new Error("Only pending claims require officer judgment.");
    const extensionClaim = claim.origin === "extension_scrape" || (!claim.origin && claim.source !== "manual");
    if (review.decision === "scraper_defect" && !extensionClaim) throw new Error("Scraper defect requires extension evidence.");
    if (review.decision === "confirm_falsification" && extensionClaim) throw new Error("Falsification decision requires manual evidence.");
    if (review.decision === "confirm_tampering" && !extensionClaim) throw new Error("Tampering decision requires extension evidence.");
    const approved = review.decision === "approve";
    const units = { participation: 1, contributor: 2, finalist_lead: 3, winner_top_award: 4 }[review.level || "participation"];
    const weight = claim.source === "github" ? 2 : 3;
    const updated = { ...claim, provenance: approved ? "officer_reviewed" as const : review.decision === "scraper_defect" ? "disputed" as const : "rejected" as const, proposedLevel: review.level || claim.proposedLevel, decisionReason: review.reason || null, points: approved ? units * 10 * weight : 0, updatedAt: new Date().toISOString() };
    db.prepare("UPDATE evidence_claims_demo SET payload=? WHERE id=?").run(JSON.stringify(updated), id);
    return updated;
  } finally { db.close(); }
}

export async function readMemberEvidenceIntegrity(userId: string): Promise<EvidenceIntegrityCase[]> {
  if (!userId) throw new Error("Authentication required.");
  // Integrity cases are served by the Rust API; this local store records none.
  return [];
}

export async function openEvidenceAppeal(userId: string, input: unknown) {
  if (!userId) throw new Error("Authentication required.");
  evidenceAppealRequestSchema.parse(input);
  // Appeals are served by the Rust API; the local demo store holds no sanctions.
  throw new Error("No active local-demo sanction is available to appeal.");
}

export async function readOfficerEvidenceAppeals(viewer: ViewerContext): Promise<OfficerEvidenceAppeal[]> {
  assertOfficer(viewer);
  return [] as OfficerEvidenceAppeal[];
}

export async function resolveEvidenceAppeal(viewer: ViewerContext, appealId: string, input: unknown) {
  assertOfficer(viewer);
  evidenceAppealDecisionSchema.parse(input);
  throw new Error(`No active local-demo appeal ${appealId} is available.`);
}

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try { return JSON.parse(String(value || "[]")) as T[]; } catch { return []; }
}

function rowToEvent(row: Record<string, unknown>, viewer: ViewerContext): ExternalEvent {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as EventPackage : row.payload as EventPackage;
  const requiredDepartments = jsonArray<Department>(row.required_departments ?? row.requiredDepartments);
  const approvedDepartments = jsonArray<Department>(row.approved_departments ?? row.approvedDepartments);
  const mayReviewOperations = viewer.isOfficer && viewer.audience === "officer";
  const emailDraft: EventMailDraft | null = mayReviewOperations && (row.email_subject || row.emailDraft) ? (row.emailDraft as EventMailDraft) || {
    subject: String(row.email_subject), body: String(row.email_body), revisionHash: String(row.revision_hash),
    deliveryMode: String(row.delivery_mode || "copy_export") as EventMailDraft["deliveryMode"],
    deliveryStatus: String(row.delivery_status || "pending") as EventMailDraft["deliveryStatus"],
  } : null;
  return {
    ...payload,
    id: String(row.id), submittedBy: String(row.submitted_by ?? row.submittedBy),
    submitterLabel: String(row.submitted_by ?? row.submittedBy) === viewer.userId ? "You" : `Member ${String(row.submitted_by ?? row.submittedBy).slice(0, 8).toUpperCase()}`,
    status: String(row.status) as ExternalEvent["status"], interested: Boolean(row.interested), interestCount: Number(row.interest_count ?? row.interestCount ?? 0),
    revision: Number(row.revision || 1), requiredDepartments, approvedDepartments,
    departmentApprovals: approvedDepartments.length, departmentTotal: requiredDepartments.length,
    emailDraft, sadoReference: mayReviewOperations && row.sado_reference ? String(row.sado_reference) : null,
    createdAt: String(row.created_at ?? row.createdAt),
  };
}

const localEventQuery = `SELECT e.*,m.subject email_subject,m.body email_body,m.revision_hash,m.delivery_mode,m.delivery_status,m.provider,
  EXISTS(SELECT 1 FROM external_event_interests_demo i WHERE i.event_id=e.id AND i.user_id=?) interested,
  (SELECT count(*) FROM external_event_interests_demo i WHERE i.event_id=e.id) interest_count
  FROM external_events_demo e LEFT JOIN event_mail_demo m ON m.event_id=e.id`;

export async function readExternalEvents(viewer: ViewerContext): Promise<ExternalEvent[]> {
  if (!viewer.userId) throw new Error("Authentication required.");
  const db = openOperationsDatabase();
  try { return db.prepare(`${localEventQuery} ORDER BY e.created_at DESC`).all(viewer.userId).map((row) => rowToEvent(row as Record<string, unknown>, viewer)); }
  finally { db.close(); }
}

export async function submitExternalEvent(viewer: ViewerContext, input: unknown): Promise<ExternalEvent> {
  if (!viewer.userId) throw new Error("Authentication required.");
  const payload = eventPackageSchema.parse(input);
  const required = requiredDepartmentsByCategory[payload.category];
  const id = randomUUID(); const createdAt = new Date().toISOString();
  const db = openOperationsDatabase();
  try {
    db.prepare("INSERT INTO external_events_demo (id,submitted_by,payload,status,interested,interest_count,approvals,approval_total,created_at,revision,required_departments,approved_departments) VALUES (?,?,?,?,0,0,0,?,?,1,?,?)")
      .run(id, viewer.userId, JSON.stringify(payload), "not_sado_approved", required.length, createdAt, JSON.stringify(required), "[]");
    return rowToEvent({ id, submitted_by: viewer.userId, payload: JSON.stringify(payload), status: "not_sado_approved", interested: 0, interest_count: 0, revision: 1, required_departments: JSON.stringify(required), approved_departments: "[]", created_at: createdAt }, viewer);
  } finally { db.close(); }
}

function makeMailDraft(payload: EventPackage) {
  const subject = `SADO endorsement request — ${payload.title}`;
  const body = `Organizer: ${payload.organizer}\nEvent: ${payload.title}\nSchedule: ${payload.startAt} (${payload.timezone})\nVenue: ${payload.venue}\nSource: ${payload.sourceUrl}\n\n${payload.summary}`;
  return { subject, body, revisionHash: createHash("sha256").update(subject + body).digest("hex") };
}

async function localEventAction(viewer: ViewerContext, id: string, action: EventAction): Promise<ExternalEvent> {
  const db = openOperationsDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT * FROM external_events_demo WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Event not found.");
    if (action.action === "interest") {
      db.prepare("INSERT OR IGNORE INTO external_event_interests_demo (event_id,user_id,created_at) VALUES (?,?,?)")
        .run(id, viewer.userId, new Date().toISOString());
    } else {
      assertOfficer(viewer);
      if (action.action === "approve_department") {
        const required = jsonArray<Department>(row.required_departments);
        const approved = jsonArray<Department>(row.approved_departments);
        const requested = action.department || required.find((department) => !approved.includes(department));
        if (!requested || !required.includes(requested)) throw new Error("No required department remains for this revision.");
        const next = approved.includes(requested) ? approved : [...approved, requested];
        const status = next.length === required.length ? "email_review" : "department_review";
        db.prepare("UPDATE external_events_demo SET approved_departments=?,approvals=?,status=? WHERE id=?").run(JSON.stringify(next), next.length, status, id);
        if (status === "email_review") {
          const draft = makeMailDraft(JSON.parse(String(row.payload)) as EventPackage);
          const mode = configuredMailAdapter().mode;
          db.prepare("INSERT OR REPLACE INTO event_mail_demo (event_id,subject,body,revision_hash,delivery_mode,delivery_status) VALUES (?,?,?,?,?,'pending')").run(id, draft.subject, draft.body, draft.revisionHash, mode);
        }
      }
      if (action.action === "approve_email") {
        if (String(row.status) !== "email_review") throw new Error("Department approvals are incomplete.");
        const mail = db.prepare("SELECT * FROM event_mail_demo WHERE event_id=?").get(id) as Record<string, unknown> | undefined;
        if (!mail) throw new Error("The exact final email is not ready for approval.");
        if (mail.sent_at) {
          if (mail.provider === "gmail") db.prepare("UPDATE external_events_demo SET status='submitted_to_sado' WHERE id=?").run(id);
        }
        else {
          const adapter = configuredMailAdapter();
          if (mail.delivery_status === "sending") throw new Error("Delivery already in progress.");
          const recipient = process.env.PYTORCH_PH_SADO_EMAIL || "reviewed-export@local.invalid";
          const idempotencyKey = createHash("sha256").update(`${id}:${row.revision}:${mail.revision_hash}`).digest("hex");
          db.prepare("UPDATE event_mail_demo SET delivery_mode=?,delivery_status='sending',idempotency_key=?,approved_by=? WHERE event_id=? AND sent_at IS NULL")
            .run(adapter.mode, idempotencyKey, viewer.userId, id);
          db.exec("COMMIT");
          try {
            const receipt = await adapter.deliverApproved({ to: [recipient], subject: String(mail.subject), body: String(mail.body), revisionHash: String(mail.revision_hash) }, idempotencyKey);
            db.exec("BEGIN IMMEDIATE");
            db.prepare("UPDATE event_mail_demo SET approved_by=?,sent_at=?,delivery_status=?,provider=?,provider_message_id=?,idempotency_key=? WHERE event_id=? AND sent_at IS NULL")
              .run(viewer.userId, new Date().toISOString(), receipt.provider === "gmail" ? "sent" : "exported", receipt.provider, receipt.messageId, idempotencyKey, id);
            if (receipt.provider === "gmail") db.prepare("UPDATE external_events_demo SET status='submitted_to_sado' WHERE id=?").run(id);
          } catch (error) {
            db.exec("BEGIN IMMEDIATE");
            db.prepare("UPDATE event_mail_demo SET delivery_status='failed' WHERE event_id=? AND sent_at IS NULL").run(id);
            throw error;
          }
        }
      }
      if (action.action === "confirm_manual_delivery") {
        if (String(row.status) !== "email_review") throw new Error("The reviewed export is not awaiting manual delivery confirmation.");
        const mail = db.prepare("SELECT * FROM event_mail_demo WHERE event_id=?").get(id) as Record<string, unknown> | undefined;
        if (!mail || mail.delivery_status !== "exported" || mail.delivery_mode !== "copy_export") throw new Error("Export the exact reviewed email before confirming manual delivery.");
        db.prepare("UPDATE event_mail_demo SET provider_message_id=? WHERE event_id=?").run(action.detail, id);
        db.prepare("UPDATE external_events_demo SET status='submitted_to_sado' WHERE id=?").run(id);
      }
      if (action.action === "record_sado_approval") {
        if (String(row.status) !== "submitted_to_sado") throw new Error("The request has not been delivered to SADO.");
        db.prepare("UPDATE external_events_demo SET status='sado_approved',sado_reference=? WHERE id=?").run(action.detail, id);
      }
    }
    db.exec("COMMIT");
    const finalRow = db.prepare(`${localEventQuery} WHERE e.id=?`).get(viewer.userId, id) as Record<string, unknown>;
    return rowToEvent(finalRow, viewer);
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed around delivery */ }
    throw error;
  } finally { db.close(); }
}

export async function eventAction(viewer: ViewerContext, id: string, action: EventAction): Promise<ExternalEvent> {
  if (!viewer.userId) throw new Error("Authentication required.");
  return localEventAction(viewer, id, action);
}
