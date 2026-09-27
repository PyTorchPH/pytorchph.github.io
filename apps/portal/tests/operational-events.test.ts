import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { operationalEventSchema } from "@pytorch-ph/domain-protocol/privacy-feedback";

const event = {
  eventId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  component: "portal.browser",
  stage: "runtime",
  code: "window_error",
  severity: "error" as const,
  outcome: "failed" as const,
  retryable: false,
  occurredAt: "2026-08-27T03:00:00.000Z",
  route: "/leaderboards",
};

test("operational events accept bounded metadata and reject sensitive additions", () => {
  assert.equal(operationalEventSchema.safeParse(event).success, true);
  assert.equal(operationalEventSchema.safeParse({ ...event, cookies: "secret" }).success, false);
  assert.equal(operationalEventSchema.safeParse({ ...event, details: { message: "redacted", stack: "full stack" } }).success, false);
  assert.equal(operationalEventSchema.safeParse({ ...event, route: "https://outside.example" }).success, false);
});

test("client telemetry covers errors and rejected promises without raw browser state", () => {
  const source = readFileSync(new URL("../../../domains/client/privacy-feedback/collect-report.tsx", import.meta.url), "utf8");
  assert.match(source, /window_error/);
  assert.match(source, /unhandled_rejection/);
  for (const forbidden of ["document.cookie", "outerHTML", "innerHTML", "localStorage", "sessionStorage"]) assert.equal(source.includes(forbidden), false);
});
