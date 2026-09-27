import { DatabaseSync } from "node:sqlite";

const SUBMITTED = "submitted";
const UNRESOLVED = new Set(["submitting", "submission_unknown"]);
const DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeExactIdentity(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanListingIdentity(value) {
  const clean = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 200) return "";
  if (/[{};]/.test(clean) || /\b(?:font-family|text-decoration|transition):/i.test(clean)) {
    return "";
  }
  return clean;
}

export function countOpenPageTargets(targetInfos) {
  return Array.isArray(targetInfos)
    ? targetInfos.filter((target) => target?.type === "page").length
    : 0;
}

export function isIndeedOwnedHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  return host === "indeed.com" || host.endsWith(".indeed.com");
}

export function classifyApplyDestination(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { kind: "pending", reason: "destination_not_http" };
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    return { kind: "pending", reason: "destination_not_http" };
  }
  const host = url.hostname.toLowerCase();
  if (host === "smartapply.indeed.com") {
    return { kind: "indeed_smart_apply", host };
  }
  if (isIndeedOwnedHost(host)) {
    return { kind: "pending", reason: "indeed_navigation_in_progress", host };
  }
  return { kind: "external_company_site", host };
}

export function sanitizeSourceUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function indeedProviderJobId(task, sourceUrl) {
  const taskId = String(task?.task_id ?? "").trim();
  if (/^[a-zA-Z0-9]+$/.test(taskId)) return taskId;
  const url = new URL(sourceUrl);
  const jobId = String(url.searchParams.get("jk") ?? "").trim();
  return /^[a-zA-Z0-9]+$/.test(jobId) ? jobId : "";
}

export function isExactIndeedConfirmation(snapshot) {
  return (
    snapshot.host === "smartapply.indeed.com" &&
    snapshot.path.endsWith("/post-apply") &&
    snapshot.accessBlocked === false &&
    snapshot.visibleText.toLowerCase().includes("your application has been submitted")
  );
}

export function applyTriggerDecision({
  eventKind,
  enabled = false,
  mapped = false,
}) {
  if (!enabled) {
    return { trigger: false, reason: "automatic_apply_disabled" };
  }
  if (eventKind !== "apply_click") {
    return { trigger: false, reason: "event_not_verified_apply_click" };
  }
  if (!mapped) return { trigger: false, reason: "apply_click_unmapped" };
  return {
    trigger: true,
    reason: "verified_apply_click",
  };
}

export function automationResumeDecision({
  snapshot,
  task,
  runnerEnabled = false,
  running = false,
  handledRouteKey = "",
}) {
  if (!runnerEnabled) return { resume: false, reason: "runner_disabled" };
  if (!task?.resume_file || !task?.target_country || !task?.work_mode) {
    return { resume: false, reason: "incomplete_manifest_task" };
  }
  if (snapshot?.host !== "smartapply.indeed.com") {
    return { resume: false, reason: "not_smart_apply" };
  }
  if (snapshot?.accessBlocked) return { resume: false, reason: "access_blocked" };
  if (isExactIndeedConfirmation(snapshot) || snapshot?.path?.endsWith("/post-apply")) {
    return { resume: false, reason: "already_submitted" };
  }
  if (running) return { resume: false, reason: "runner_active" };
  const routeKey = `${task.task_id}\n${snapshot.path}`;
  if (handledRouteKey === routeKey) {
    return { resume: false, reason: "route_already_handled", routeKey };
  }
  return { resume: true, reason: "clear_smart_apply_route", routeKey };
}

export class MicrotaskCoalescer {
  #states = new Map();

  schedule(key, operation) {
    const state = this.#states.get(key) ?? {
      queued: false,
      running: false,
      rerun: false,
      operation,
    };
    state.operation = operation;
    if (state.running) {
      state.rerun = true;
      this.#states.set(key, state);
      return;
    }
    if (state.queued) return;
    state.queued = true;
    this.#states.set(key, state);
    queueMicrotask(async () => {
      state.queued = false;
      state.running = true;
      try {
        await state.operation();
      } finally {
        state.running = false;
        if (state.rerun) {
          state.rerun = false;
          this.schedule(key, state.operation);
        } else if (!state.queued) {
          this.#states.delete(key);
        }
      }
    });
  }
}

export class SubmissionStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.#initialize();
  }

  close() {
    this.database.close();
  }

  recordConfirmed(task, sourceUrl, observedAt = new Date()) {
    const company = String(task.company ?? "").trim().replace(/\s+/g, " ");
    const jobTitle = String(task.job_title ?? "").trim().replace(/\s+/g, " ");
    if (!company || !jobTitle) throw new Error("exact company and job title are required");
    const companyKey = normalizeExactIdentity(company);
    const titleKey = normalizeExactIdentity(jobTitle);
    const now = observedAt.toISOString();
    const cutoff = new Date(observedAt.getTime() - DUPLICATE_WINDOW_MS).toISOString();
    const safeUrl = sanitizeSourceUrl(sourceUrl);
    const domain = new URL(safeUrl).hostname.toLowerCase();
    const providerJobId = indeedProviderJobId(task, sourceUrl);
    const confirmation = "observable Indeed post-apply page reached by event watcher";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const identity = this.#ensureNormalizedIdentity({
        company,
        companyKey,
        jobTitle,
        titleKey,
        provider: providerJobId ? "indeed" : "",
        providerJobId,
        sourceUrl: safeUrl,
        observedAt: now,
      });
      const existing = this.database
        .prepare(
          `SELECT id FROM applications
           WHERE (job_posting_id = ? OR (company_key = ? AND job_title_key = ?))
             AND state = ? AND applied_at >= ?
           ORDER BY applied_at DESC LIMIT 1`,
        )
        .get(identity.jobPostingId, companyKey, titleKey, SUBMITTED, cutoff);
      if (existing) {
        this.database
          .prepare(
            `UPDATE applications
             SET company_id = COALESCE(company_id, ?),
                 job_posting_id = COALESCE(job_posting_id, ?)
             WHERE id = ?`,
          )
          .run(identity.companyId, identity.jobPostingId, existing.id);
        this.database.exec("COMMIT");
        return { status: "matched_existing", applicationId: Number(existing.id) };
      }
      const unresolved = this.database
        .prepare(
          `SELECT id, state FROM applications
           WHERE (job_posting_id = ? OR (company_key = ? AND job_title_key = ?))
             AND state IN (?, ?)
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(identity.jobPostingId, companyKey, titleKey, ...UNRESOLVED);
      let applicationId;
      if (unresolved) {
        applicationId = Number(unresolved.id);
        this.database
          .prepare(
            `UPDATE applications
             SET state = ?, applied_at = ?, updated_at = ?, confirmation = ?,
                 confirmation_source = ?, source_domain = ?, source_url = ?,
                 company_id = ?, job_posting_id = ?
             WHERE id = ?`,
          )
          .run(
            SUBMITTED,
            now,
            now,
            confirmation,
            "browser",
            domain,
            safeUrl,
            identity.companyId,
            identity.jobPostingId,
            applicationId,
          );
      } else {
        const inserted = this.database
          .prepare(
            `INSERT INTO applications (
               company, job_title, company_key, job_title_key, state,
               applied_at, updated_at, confirmation, confirmation_source,
               source_domain, source_url, company_id, job_posting_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            company,
            jobTitle,
            companyKey,
            titleKey,
            SUBMITTED,
            now,
            now,
            confirmation,
            "browser",
            domain,
            safeUrl,
            identity.companyId,
            identity.jobPostingId,
          );
        applicationId = Number(inserted.lastInsertRowid);
      }
      this.database
        .prepare(
          `INSERT INTO submission_audit (
             application_id, event_at, company, job_title, action, decision, details
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          applicationId,
          now,
          company,
          jobTitle,
          "submission_confirmed",
          SUBMITTED,
          confirmation,
        );
      this.database.exec("COMMIT");
      return {
        status: unresolved ? "resolved_unconfirmed_attempt" : "inserted",
        applicationId,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  #initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company TEXT NOT NULL,
        job_title TEXT NOT NULL,
        company_key TEXT NOT NULL,
        job_title_key TEXT NOT NULL,
        state TEXT NOT NULL,
        applied_at TEXT,
        updated_at TEXT NOT NULL,
        confirmation TEXT NOT NULL DEFAULT '',
        source_domain TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        confirmation_source TEXT NOT NULL DEFAULT '',
        company_id INTEGER,
        job_posting_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_applications_recent_exact
        ON applications(company_key, job_title_key, state, applied_at);
      CREATE INDEX IF NOT EXISTS idx_applications_unresolved_exact
        ON applications(company_key, job_title_key, state, updated_at);
      CREATE TABLE IF NOT EXISTS submission_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        event_at TEXT NOT NULL,
        company TEXT NOT NULL,
        job_title TEXT NOT NULL,
        action TEXT NOT NULL,
        decision TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(application_id) REFERENCES applications(id)
      );
      CREATE INDEX IF NOT EXISTS idx_submission_audit_application
        ON submission_audit(application_id, event_at);
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_postings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        provider_job_id TEXT NOT NULL DEFAULT '',
        canonical_title TEXT NOT NULL,
        title_key TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(company_id) REFERENCES companies(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_job_postings_provider_identity
        ON job_postings(provider, provider_job_id)
        WHERE provider <> '' AND provider_job_id <> '';
      CREATE INDEX IF NOT EXISTS idx_job_postings_company_title
        ON job_postings(company_id, title_key);
      CREATE TABLE IF NOT EXISTS job_title_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_posting_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        title_key TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        FOREIGN KEY(job_posting_id) REFERENCES job_postings(id),
        UNIQUE(job_posting_id, title_key)
      );
    `);
    const columns = this.database.prepare("PRAGMA table_info(applications)").all();
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("company_id")) {
      this.database.exec("ALTER TABLE applications ADD COLUMN company_id INTEGER");
    }
    if (!columnNames.has("job_posting_id")) {
      this.database.exec("ALTER TABLE applications ADD COLUMN job_posting_id INTEGER");
    }
    const timestamp = new Date().toISOString();
    const legacyRows = this.database
      .prepare(
        `SELECT id, company, job_title, company_key, job_title_key, source_url
         FROM applications WHERE company_id IS NULL OR job_posting_id IS NULL
         ORDER BY id`,
      )
      .all();
    for (const row of legacyRows) {
      const identity = this.#ensureNormalizedIdentity({
        company: row.company,
        companyKey: row.company_key,
        jobTitle: row.job_title,
        titleKey: row.job_title_key,
        provider: "",
        providerJobId: "",
        sourceUrl: row.source_url,
        observedAt: timestamp,
      });
      this.database
        .prepare("UPDATE applications SET company_id = ?, job_posting_id = ? WHERE id = ?")
        .run(identity.companyId, identity.jobPostingId, row.id);
    }
  }

  #ensureNormalizedIdentity({
    company,
    companyKey,
    jobTitle,
    titleKey,
    provider,
    providerJobId,
    sourceUrl,
    observedAt,
  }) {
    this.database
      .prepare(
        `INSERT INTO companies (name, name_key, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name_key) DO UPDATE
         SET name = excluded.name, updated_at = excluded.updated_at`,
      )
      .run(company, companyKey, observedAt, observedAt);
    const companyRow = this.database
      .prepare("SELECT id FROM companies WHERE name_key = ?")
      .get(companyKey);
    const companyId = Number(companyRow.id);
    let posting;
    if (provider && providerJobId) {
      posting = this.database
        .prepare("SELECT id FROM job_postings WHERE provider = ? AND provider_job_id = ?")
        .get(provider, providerJobId);
    }
    if (!posting) {
      posting = this.database
        .prepare(
          `SELECT id FROM job_postings
           WHERE company_id = ? AND title_key = ? ORDER BY id LIMIT 1`,
        )
        .get(companyId, titleKey);
    }
    let jobPostingId;
    if (posting) {
      jobPostingId = Number(posting.id);
      this.database
        .prepare(
          `UPDATE job_postings
           SET provider = CASE WHEN provider = '' THEN ? ELSE provider END,
               provider_job_id = CASE WHEN provider_job_id = '' THEN ? ELSE provider_job_id END,
               canonical_title = ?, title_key = ?,
               source_url = CASE WHEN ? <> '' THEN ? ELSE source_url END,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          provider,
          providerJobId,
          jobTitle,
          titleKey,
          sourceUrl,
          sourceUrl,
          observedAt,
          jobPostingId,
        );
    } else {
      const inserted = this.database
        .prepare(
          `INSERT INTO job_postings (
             company_id, provider, provider_job_id, canonical_title, title_key,
             source_url, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          companyId,
          provider,
          providerJobId,
          jobTitle,
          titleKey,
          sourceUrl,
          observedAt,
          observedAt,
        );
      jobPostingId = Number(inserted.lastInsertRowid);
    }
    this.database
      .prepare(
        `INSERT INTO job_title_aliases (job_posting_id, title, title_key, observed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(job_posting_id, title_key) DO UPDATE
         SET title = excluded.title, observed_at = excluded.observed_at`,
      )
      .run(jobPostingId, jobTitle, titleKey, observedAt);
    return { companyId, jobPostingId };
  }
}
