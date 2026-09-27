import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  MicrotaskCoalescer,
  SubmissionStore,
  applyTriggerDecision,
  automationResumeDecision,
  classifyApplyDestination,
  cleanListingIdentity,
  countOpenPageTargets,
  isExactIndeedConfirmation,
  normalizeExactIdentity,
} from "../../tools/job_finder/indeed_event_watcher_core.mjs";
import {
  enqueueExternalHandoff,
  sanitizeExternalApplicationUrl,
} from "../../tools/job_finder/external_handoff_queue.mjs";

test("listing identity rejects transient CSS contamination", () => {
  assert.equal(cleanListingIdentity("  EzzyBills  "), "EzzyBills");
  assert.equal(
    cleanListingIdentity(".css-a{font-family:sans-serif;}UpGuard"),
    "",
  );
  assert.equal(cleanListingIdentity("x".repeat(201)), "");
});

test("tab pressure counts current page targets only", () => {
  assert.equal(
    countOpenPageTargets([
      { type: "page" },
      { type: "page" },
      { type: "service_worker" },
      { type: "background_page" },
    ]),
    2,
  );
  assert.equal(countOpenPageTargets(undefined), 0);
});

test("clear Smart Apply routes resume one fully mapped job exactly once", () => {
  const snapshot = {
    host: "smartapply.indeed.com",
    path: "/beta/indeedapply/form/questions-module",
    visibleText: "Application questions",
    accessBlocked: false,
  };
  const task = {
    task_id: "job-1",
    company: "Example",
    job_title: "Engineer",
    target_country: "Australia",
    work_mode: "remote",
    resume_file: "software-systems.pdf",
  };
  const first = automationResumeDecision({
    snapshot,
    task,
    runnerEnabled: true,
  });
  assert.equal(first.resume, true);
  assert.equal(
    automationResumeDecision({
      snapshot,
      task,
      runnerEnabled: true,
      handledRouteKey: first.routeKey,
    }).reason,
    "route_already_handled",
  );
  assert.equal(
    automationResumeDecision({
      snapshot: { ...snapshot, accessBlocked: true },
      task,
      runnerEnabled: true,
    }).reason,
    "access_blocked",
  );
});

test("automation resume fails closed without runner, manifest data, or on post-apply", () => {
  const clear = {
    host: "smartapply.indeed.com",
    path: "/beta/indeedapply/form/contact-info-module",
    visibleText: "Contact info",
    accessBlocked: false,
  };
  assert.equal(
    automationResumeDecision({ snapshot: clear, task: {}, runnerEnabled: true }).reason,
    "incomplete_manifest_task",
  );
  assert.equal(
    automationResumeDecision({
      snapshot: clear,
      task: { resume_file: "r.pdf", target_country: "Canada", work_mode: "remote" },
    }).reason,
    "runner_disabled",
  );
  assert.equal(
    automationResumeDecision({
      snapshot: {
        ...clear,
        path: "/beta/indeedapply/form/post-apply",
        visibleText: "Your application has been submitted!",
      },
      task: {
        task_id: "job-1",
        resume_file: "r.pdf",
        target_country: "Canada",
        work_mode: "remote",
      },
      runnerEnabled: true,
    }).reason,
    "already_submitted",
  );
});

test("only an actual verified, mapped Apply click triggers destination tracking", () => {
  assert.deepEqual(
    applyTriggerDecision({
      eventKind: "apply_click",
      enabled: true,
      mapped: true,
    }),
    {
      trigger: true,
      reason: "verified_apply_click",
    },
  );
  assert.equal(
    applyTriggerDecision({
      eventKind: "focus",
      enabled: true,
      mapped: true,
    }).reason,
    "event_not_verified_apply_click",
  );
});

test("apply click tracking fails closed for background and unmapped events", () => {
  assert.equal(
    applyTriggerDecision({ eventKind: "mutation", enabled: true, mapped: true }).reason,
    "event_not_verified_apply_click",
  );
  assert.equal(
    applyTriggerDecision({
      eventKind: "apply_click",
      enabled: true,
      mapped: false,
    }).reason,
    "apply_click_unmapped",
  );
});

test("automatic Apply is disabled unless explicitly enabled", () => {
  assert.equal(
    applyTriggerDecision({
      eventKind: "apply_click",
      mapped: true,
    }).reason,
    "automatic_apply_disabled",
  );
});

test("Apply destinations are classified from the observed URL, not button text", () => {
  assert.equal(
    classifyApplyDestination("about:blank").kind,
    "pending",
  );
  assert.equal(
    classifyApplyDestination("https://ca.indeed.com/rc/clk?jk=job").kind,
    "pending",
  );
  assert.equal(
    classifyApplyDestination("https://smartapply.indeed.com/form/contact-info").kind,
    "indeed_smart_apply",
  );
  assert.deepEqual(
    classifyApplyDestination("https://careers.example.com/apply?token=secret"),
    { kind: "external_company_site", host: "careers.example.com" },
  );
});

test("external handoff queue strips secrets and preserves structured job identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "external-handoff-"));
  const path = join(root, "queue.json");
  const entry = await enqueueExternalHandoff(
    path,
    {
      task_id: "job-1",
      company: "Example Co",
      job_title: "Backend Engineer",
      goal_id: "goal-1",
      resume_file: "/tmp/software-systems.pdf",
    },
    {
      url: "https://careers.example.com/apply?token=secret#private",
      targetId: "TARGET_1",
    },
  );

  assert.equal(entry.action, "external_application");
  assert.equal(entry.url, "https://careers.example.com/apply");
  assert.equal(entry.browser_target_id, "TARGET_1");
  assert.equal(entry.company, "Example Co");
  assert.equal(entry.job_title, "Backend Engineer");
  assert.equal(entry.resume_file, "software-systems.pdf");
  assert.equal(readFileSync(path, "utf8").includes("secret"), false);
  assert.equal(
    sanitizeExternalApplicationUrl("https://apply.example.com/path?q=private"),
    "https://apply.example.com/path",
  );
});

test("confirmation requires exact route, text, and clear access", () => {
  const proof = {
    host: "smartapply.indeed.com",
    path: "/beta/indeedapply/form/post-apply",
    visibleText: "Your application has been submitted!",
    accessBlocked: false,
  };
  assert.equal(isExactIndeedConfirmation(proof), true);
  assert.equal(isExactIndeedConfirmation({ ...proof, path: "/review-module" }), false);
  assert.equal(isExactIndeedConfirmation({ ...proof, visibleText: "Thanks" }), false);
  assert.equal(isExactIndeedConfirmation({ ...proof, accessBlocked: true }), false);
});

test("microtask scheduler coalesces an event burst and preserves a rerun", async () => {
  const queue = new MicrotaskCoalescer();
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const operation = async () => {
    calls += 1;
    if (calls === 1) await blocked;
  };
  queue.schedule("page", operation);
  queue.schedule("page", operation);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  queue.schedule("page", operation);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("event confirmation inserts once and remains idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "indeed-watcher-"));
  const databasePath = join(directory, "applications.sqlite3");
  const store = new SubmissionStore(databasePath);
  const task = {
    task_id: "5bae6308f955f822",
    company: "Binance",
    job_title: "Applied Data Scientist",
  };
  const first = store.recordConfirmed(
    task,
    "https://smartapply.indeed.com/beta/indeedapply/form/post-apply?secret=removed",
    new Date("2026-07-24T12:00:00Z"),
  );
  const second = store.recordConfirmed(
    task,
    "https://smartapply.indeed.com/beta/indeedapply/form/post-apply",
    new Date("2026-07-24T12:01:00Z"),
  );
  store.close();

  assert.equal(first.status, "inserted");
  assert.equal(second.status, "matched_existing");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const rows = database.prepare("SELECT * FROM applications").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "submitted");
  const companies = database.prepare("SELECT * FROM companies").all();
  const postings = database.prepare("SELECT * FROM job_postings").all();
  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, "Binance");
  assert.equal(postings.length, 1);
  assert.equal(postings[0].company_id, companies[0].id);
  assert.equal(postings[0].provider, "indeed");
  assert.equal(postings[0].provider_job_id, "5bae6308f955f822");
  assert.equal(
    rows[0].source_url,
    "https://smartapply.indeed.com/beta/indeedapply/form/post-apply",
  );
  assert.equal(normalizeExactIdentity("  Applied   Data Scientist "), "applied data scientist");
  database.close();
});

test("event confirmation resolves an exact unknown submission attempt", () => {
  const directory = mkdtempSync(join(tmpdir(), "indeed-watcher-"));
  const databasePath = join(directory, "applications.sqlite3");
  const store = new SubmissionStore(databasePath);
  const database = new DatabaseSync(databasePath);
  const inserted = database
    .prepare(
      `INSERT INTO applications (
         company, job_title, company_key, job_title_key, state, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "Binance",
      "Applied Data Scientist",
      "binance",
      "applied data scientist",
      "submission_unknown",
      "2026-07-24T11:59:00.000Z",
    );
  database.close();

  const result = store.recordConfirmed(
    { company: "Binance", job_title: "Applied Data Scientist" },
    "https://smartapply.indeed.com/beta/indeedapply/form/post-apply",
    new Date("2026-07-24T12:00:00Z"),
  );
  store.close();

  assert.equal(result.status, "resolved_unconfirmed_attempt");
  assert.equal(result.applicationId, Number(inserted.lastInsertRowid));
  const verified = new DatabaseSync(databasePath, { readOnly: true });
  const row = verified
    .prepare("SELECT state, confirmation_source FROM applications WHERE id = ?")
    .get(result.applicationId);
  assert.equal(row.state, "submitted");
  assert.equal(row.confirmation_source, "browser");
  verified.close();
});
