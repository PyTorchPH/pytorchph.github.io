import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ViewerContext } from "@pytorch-ph/domain-server/identity";
import { eventAction, readExternalEvents, submitExternalEvent } from "@pytorch-ph/domain-server/organization";
import {
  eventActionSchema,
  eventPackageSchema,
  requiredDepartmentsByCategory,
} from "@pytorch-ph/domain-protocol/organization";
import { configuredMailAdapter } from "@pytorch-ph/domain-server/organization";

const eventPackage = {
  title: "Regional PyTorch Workshop",
  organizer: "Example University",
  summary: "A public workshop with a published program and registration page.",
  category: "workshops",
  scope: "external",
  startAt: "2026-09-10T09:00:00+08:00",
  endAt: null,
  timezone: "Asia/Manila",
  venue: "Innovation Hall",
  registrationUrl: "https://events.example/register",
  registrationDeadline: null,
  fee: "Free",
  eligibility: ["Students"],
  requirements: [],
  sourceUrl: "https://events.example/workshop",
  scrapedAt: "2026-08-22T00:00:00Z",
  contentHash: `sha256:${"a".repeat(64)}`,
  scraperVersion: "visible-browser-v1",
  confidence: 0.9,
  warnings: [],
};

test("external event contracts reject unknown fields and incomplete proof", () => {
  assert.equal(eventPackageSchema.safeParse(eventPackage).success, true);
  assert.equal(eventPackageSchema.safeParse({ ...eventPackage, approved: true }).success, false);
  assert.equal(eventActionSchema.safeParse({ action: "record_sado_approval", detail: "x" }).success, false);
  assert.equal(eventActionSchema.safeParse({ action: "confirm_manual_delivery", detail: "EMAIL-SENT-104" }).success, true);
  assert.equal(eventActionSchema.safeParse({ action: "approve_email", detail: "smuggled" }).success, false);
});

test("category routing returns the required unanimous departments", () => {
  assert.deepEqual(requiredDepartmentsByCategory.workshops, ["secretariat", "external_relations"]);
  assert.deepEqual(requiredDepartmentsByCategory.events, ["secretariat", "treasurer", "external_relations", "executive"]);
  for (const departments of Object.values(requiredDepartmentsByCategory)) assert.equal(new Set(departments).size, departments.length);
});

test("copy/export is the safe default mail adapter", async () => {
  const previous = process.env.PYTORCH_PH_EVENT_MAIL_MODE;
  delete process.env.PYTORCH_PH_EVENT_MAIL_MODE;
  try {
    const adapter = configuredMailAdapter();
    assert.equal(adapter.mode, "copy_export");
    const receipt = await adapter.deliverApproved({ to: ["reviewed-export@local.invalid"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key");
    assert.deepEqual(receipt, { provider: "copy_export", messageId: "export:stable-key" });
  } finally {
    if (previous === undefined) delete process.env.PYTORCH_PH_EVENT_MAIL_MODE;
    else process.env.PYTORCH_PH_EVENT_MAIL_MODE = previous;
  }
});

test("Gmail mode fails closed when configuration or recipient allowlist is wrong", async () => {
  const previous = { mode: process.env.PYTORCH_PH_EVENT_MAIL_MODE, token: process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN, recipient: process.env.PYTORCH_PH_SADO_EMAIL };
  process.env.PYTORCH_PH_EVENT_MAIL_MODE = "gmail";
  delete process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN;
  process.env.PYTORCH_PH_SADO_EMAIL = "sado@example.edu";
  try {
    await assert.rejects(() => configuredMailAdapter().deliverApproved({ to: ["sado@example.edu"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key"), /not fully configured/);
    process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN = "test-token";
    await assert.rejects(() => configuredMailAdapter().deliverApproved({ to: ["other@example.edu"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key"), /allowlist/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "mode" ? "PYTORCH_PH_EVENT_MAIL_MODE" : key === "token" ? "PYTORCH_PH_GMAIL_ACCESS_TOKEN" : "PYTORCH_PH_SADO_EMAIL";
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});

test("local event workflow keeps interests per user and requires manual delivery proof", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pytorch-ph-operations-"));
  const previous = {
    database: process.env.PYTORCH_PH_LOCAL_DATABASE_PATH,
    provider: process.env.PYTORCH_PH_DATA_PROVIDER,
    mail: process.env.PYTORCH_PH_EVENT_MAIL_MODE,
  };
  process.env.PYTORCH_PH_LOCAL_DATABASE_PATH = path.join(directory, "product.sqlite3");
  process.env.PYTORCH_PH_DATA_PROVIDER = "local";
  process.env.PYTORCH_PH_EVENT_MAIL_MODE = "copy_export";
  const viewer = (userId: string, audience: "member" | "officer", isOfficer = false): ViewerContext => ({
    userId,
    audience,
    role: isOfficer ? "admin" : "member",
    isOfficer,
    isAdmin: isOfficer,
    canViewDiagnostics: isOfficer,
    userTier: isOfficer ? "admin" : "general",
    localDevelopment: true,
  });
  const firstMember = viewer("00000000-0000-4000-8000-000000000001", "member");
  const secondMember = viewer("00000000-0000-4000-8000-000000000003", "member");
  const officer = viewer("00000000-0000-4000-8000-000000000002", "officer", true);
  try {
    const created = await submitExternalEvent(firstMember, eventPackage);
    await eventAction(firstMember, created.id, { action: "interest" });
    assert.equal((await readExternalEvents(firstMember))[0].interested, true);
    assert.equal((await readExternalEvents(secondMember))[0].interested, false);
    await eventAction(secondMember, created.id, { action: "interest" });
    assert.equal((await readExternalEvents(firstMember))[0].interestCount, 2);

    for (let index = 0; index < created.departmentTotal; index += 1) {
      await eventAction(officer, created.id, { action: "approve_department" });
    }
    const ready = (await readExternalEvents(officer))[0];
    assert.equal(ready.status, "email_review");
    assert.equal(ready.emailDraft?.deliveryStatus, "pending");
    assert.equal((await readExternalEvents(firstMember))[0].emailDraft, null);

    const exported = await eventAction(officer, created.id, { action: "approve_email" });
    assert.equal(exported.status, "email_review");
    assert.equal(exported.emailDraft?.deliveryStatus, "exported");
    assert.equal((await eventAction(officer, created.id, { action: "approve_email" })).status, "email_review");

    const submitted = await eventAction(officer, created.id, { action: "confirm_manual_delivery", detail: "THREAD-2026-104" });
    assert.equal(submitted.status, "submitted_to_sado");
    assert.equal((await eventAction(officer, created.id, { action: "record_sado_approval", detail: "SADO-2026-104" })).status, "sado_approved");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "database" ? "PYTORCH_PH_LOCAL_DATABASE_PATH" : key === "provider" ? "PYTORCH_PH_DATA_PROVIDER" : "PYTORCH_PH_EVENT_MAIL_MODE";
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
