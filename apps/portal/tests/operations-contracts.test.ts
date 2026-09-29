import assert from "node:assert/strict";
import test from "node:test";
import { evidenceReviewSchema } from "@pytorch-ph/domain-protocol/organization";

test("evidence mutations reject unknown authority actions", () => {
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve", level: "contributor" }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve" }).success, false);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "confirm_tampering", reason: "Confirmed against the immutable submitted revision." }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "auto_verify" }).success, false);
});
