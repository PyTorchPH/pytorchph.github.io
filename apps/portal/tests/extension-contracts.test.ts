import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evidenceSubmissionEnvelopeSchema } from "@pytorch-ph/domain-protocol/career-evidence";

const envelope = {
  schemaVersion: 1 as const,
  source: "github" as const,
  origin: "extension_scrape" as const,
  collectedAt: "2026-08-27T03:00:00.000Z",
  adapterVersion: "0.1.0",
  layoutFingerprint: "a".repeat(64),
  pageUrl: "https://github.com/example",
  contentHash: `sha256:${"b".repeat(64)}`,
  items: [{
    title: "Evidence collector project",
    text: "A bounded public repository description.",
    sourceUrl: "https://github.com/example/evidence-collector",
    postedAt: null,
    mediaUrls: [],
    evidenceKind: "project" as const,
    department: "academics" as const,
    proposedLevel: "contributor" as const,
  }],
  warnings: [],
};

test("extension envelopes are strict, bounded, and domain scoped", () => {
  assert.equal(evidenceSubmissionEnvelopeSchema.safeParse(envelope).success, true);
  assert.equal(evidenceSubmissionEnvelopeSchema.safeParse({ ...envelope, items: [{ ...envelope.items[0], sourceUrl: "https://evil.example/claim" }] }).success, false);
  assert.equal(evidenceSubmissionEnvelopeSchema.safeParse({ ...envelope, cookies: "secret" }).success, false);
  assert.equal(evidenceSubmissionEnvelopeSchema.safeParse({ ...envelope, source: "manual" }).success, false);
});

test("collector classifies access before inventory and emits a server-verifiable hash", () => {
  const source = readFileSync(new URL("../../evidence-extension/src/source-collector.ts", import.meta.url), "utf8");
  const gate = source.indexOf("const access = accessState()");
  const inventory = source.indexOf("const items = candidates()");
  assert.ok(gate >= 0 && inventory > gate);
  assert.match(source, /if \(!supportedPage\(\)\).*unsupported_page/);
  assert.match(source, /layout_drift/);
  assert.match(source, /contentHash: `sha256:/);
  for (const forbidden of ["document.cookie", "localStorage", "sessionStorage", "outerHTML", "innerHTML"]) assert.equal(source.includes(forbidden), false);
});
