import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { feedbackReportSchema, memberPrivacySettingsSchema } from "@pytorch-ph/domain-protocol/privacy-feedback";

const privacy = {
  hideGoogleIdentity: true,
  hideRealName: true,
  deviceCacheEnabled: true,
  anonymousRanking: true,
  automaticErrorReports: true,
};

test("privacy controls are explicit and reject unknown settings", () => {
  assert.equal(memberPrivacySettingsSchema.safeParse(privacy).success, true);
  assert.equal(memberPrivacySettingsSchema.safeParse({ ...privacy, officerCanInspectDevice: true }).success, false);
});

test("feedback diagnostics accept allowlisted UI state only", () => {
  const report = {
    category: "bug",
    description: "The ladder did not load.",
    route: "/leaderboards",
    uiState: { title: "Rankings", viewport: "1280x900", online: true, componentMarkers: ["leaderboards-table"] },
  };
  assert.equal(feedbackReportSchema.safeParse(report).success, true);
  assert.equal(feedbackReportSchema.safeParse({ ...report, uiState: { ...report.uiState, cookies: "secret" } }).success, false);
  assert.equal(feedbackReportSchema.safeParse({ ...report, route: "https://evil.example" }).success, false);
});

test("hybrid architecture documents local tampering and authority boundaries", () => {
  const document = readFileSync("../../docs/HYBRID-TRUST-ARCHITECTURE.md", "utf8");
  assert.match(document, /The Rust API is authoritative/);
  assert.match(document, /device ownership is not evidence of\s+truth/);
  assert.match(document, /silently inspect a member device/);
  assert.match(document, /Known vulnerabilities and mitigations/);
  assert.match(document, /quorum never authorizes writes/i);
});
