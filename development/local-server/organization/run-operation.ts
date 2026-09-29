import { DatabaseSync } from "node:sqlite";
import type { ViewerContext } from "@pytorch-ph/domain-server/identity";
import {
  evidenceAppealDecisionSchema,
  evidenceAppealRequestSchema,
  type EvidenceClaim,
  type EvidenceReview,
  type EvidenceIntegrityCase,
  type OfficerEvidenceAppeal,
} from "@pytorch-ph/domain-protocol/organization";
import { localDemoDatabasePath } from "@pytorch-ph/domain-server/career-evidence";

function openOperationsDatabase() {
  const db = new DatabaseSync(localDemoDatabasePath());
  db.exec("CREATE TABLE IF NOT EXISTS evidence_claims_demo (id TEXT PRIMARY KEY, payload TEXT NOT NULL);");
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
