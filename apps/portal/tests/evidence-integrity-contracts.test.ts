import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { evidenceAppealDecisionSchema, evidenceAppealSchema, evidenceReviewSchema } from "@pytorch-ph/domain-protocol/organization";
import { evidenceEnvelopeHash, submitEvidenceEnvelope } from "@pytorch-ph/domain-server/career-evidence";

test("officer decisions require a rubric level or an attributable reason", () => {
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve", level: "winner_top_award" }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve" }).success, false);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "scraper_defect", reason: "DOM selector no longer matches." }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "confirm_tampering", reason: "x" }).success, false);
});

test("appeals are bounded and cannot invent a third resolution", () => {
  assert.equal(evidenceAppealSchema.safeParse({ note: "Please review the attached immutable source again." }).success, true);
  assert.equal(evidenceAppealSchema.safeParse({ note: "short" }).success, false);
  assert.equal(evidenceAppealDecisionSchema.safeParse({ decision: "restore", reason: "Source supports the claim." }).success, true);
  assert.equal(evidenceAppealDecisionSchema.safeParse({ decision: "delete", reason: "Erase it." }).success, false);
});

test("API authority awards points only inside officer review", () => {
  const handlers = readFileSync(new URL("../../../apps/api/src/evidence.rs", import.meta.url), "utf8");
  const review = handlers.indexOf("pub async fn review_claim");
  assert.ok(review > 0, "officer review handler exists");
  assert.equal(handlers.slice(0, review).includes("INSERT INTO point_ledger"), false);
  assert.match(handlers.slice(review), /INSERT INTO point_ledger/);
});

test("local evidence submission is idempotent and creates reviewable pending claims", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pytorch-ph-evidence-"));
  const database = join(directory, "product.sqlite3");
  const previous = process.env.PYTORCH_PH_LOCAL_DATABASE_PATH;
  process.env.PYTORCH_PH_LOCAL_DATABASE_PATH = database;
  try {
    const unsigned = {
      schemaVersion: 1 as const, source: "github" as const, origin: "extension_scrape" as const,
      collectedAt: new Date().toISOString(), adapterVersion: "test-v1", layoutFingerprint: "a".repeat(64),
      pageUrl: "https://github.com/example", items: [{ title: "Reviewable project", text: "Bounded project evidence.", sourceUrl: "https://github.com/example/project", postedAt: null, mediaUrls: [], evidenceKind: "project" as const, department: "academics" as const, proposedLevel: "contributor" as const }], warnings: [],
    };
    const envelope = { ...unsigned, contentHash: evidenceEnvelopeHash(unsigned) };
    const first = await submitEvidenceEnvelope("00000000-0000-4000-8000-000000000001", envelope);
    const duplicate = await submitEvidenceEnvelope("00000000-0000-4000-8000-000000000001", envelope);
    assert.equal(first.duplicate, false);
    assert.equal(first.claimIds.length, 1);
    assert.equal(duplicate.duplicate, true);
    const db = new DatabaseSync(database, { readOnly: true });
    const claim = db.prepare("SELECT payload FROM evidence_claims_demo WHERE id=?").get(first.claimIds[0]) as { payload: string };
    db.close();
    assert.equal(JSON.parse(claim.payload).provenance, "scraped_pending");
  } finally {
    if (previous === undefined) delete process.env.PYTORCH_PH_LOCAL_DATABASE_PATH; else process.env.PYTORCH_PH_LOCAL_DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
