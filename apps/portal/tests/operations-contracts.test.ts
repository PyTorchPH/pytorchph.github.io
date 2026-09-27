import assert from "node:assert/strict";
import test from "node:test";
import { eventActionSchema, eventPackageSchema, evidenceReviewSchema } from "@pytorch-ph/domain-protocol/organization";

const eventPackage = {
  title: "External AI Challenge",
  organizer: "Example Organizer",
  summary: "A public challenge with an explicit schedule and registration page.",
  category: "hackathons",
  scope: "external",
  startAt: "2026-09-01T09:00:00+08:00",
  endAt: null,
  timezone: "Asia/Manila",
  venue: "Online",
  registrationUrl: "https://example.test/register",
  registrationDeadline: null,
  fee: "Free",
  eligibility: ["Students"],
  requirements: [],
  sourceUrl: "https://example.test/event",
  scrapedAt: "2026-08-22T00:00:00Z",
  contentHash: `sha256:${"a".repeat(64)}`,
  scraperVersion: "local-visible-playwright-v1",
  confidence: 0.9,
  warnings: [],
};

test("external event packages are strict and remain explicitly external", () => {
  assert.equal(eventPackageSchema.safeParse(eventPackage).success, true);
  assert.equal(eventPackageSchema.safeParse({ ...eventPackage, scope: "internal" }).success, false);
  assert.equal(eventPackageSchema.safeParse({ ...eventPackage, hiddenApproval: true }).success, false);
});

test("event and evidence mutations reject unknown authority actions", () => {
  assert.equal(eventActionSchema.safeParse({ action: "record_sado_approval", detail: "SADO-2026-104" }).success, true);
  assert.equal(eventActionSchema.safeParse({ action: "mark_email_sent" }).success, false);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve", level: "contributor" }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "approve" }).success, false);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "confirm_tampering", reason: "Confirmed against the immutable submitted revision." }).success, true);
  assert.equal(evidenceReviewSchema.safeParse({ decision: "auto_verify" }).success, false);
});
