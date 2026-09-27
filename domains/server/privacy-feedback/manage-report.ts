import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ViewerContext } from "@pytorch-ph/domain-server/identity";
import { configuredProductProvider } from "@pytorch-ph/domain-server/career-evidence";
import { localDemoDatabasePath, readLocalDemoState, updateLocalDemoState } from "@pytorch-ph/domain-server/career-evidence";
import { createSupabaseServerClient } from "@pytorch-ph/domain-server/identity";
import {
  feedbackReportSchema,
  feedbackUpdateSchema,
  memberPrivacySettingsSchema,
  type FeedbackReport,
  type FeedbackReportPage,
  type FeedbackReportInput,
  type FeedbackUpdate,
  type MemberPrivacySettings,
  type MembershipStatus,
  operationalEventSchema,
  type OperationalEventInput,
} from "@pytorch-ph/domain-protocol/privacy-feedback";

export async function createOperationalEvent(viewer: ViewerContext, input: unknown) {
  if (!viewer.userId) throw new Error("Authentication required.");
  const parsed = operationalEventSchema.parse(input);
  const privacy = await readPrivacySettings(viewer.userId);
  const value: OperationalEventInput = privacy.automaticErrorReports ? parsed : { ...parsed, details: undefined };
  if (configuredProductProvider() === "local") {
    const db = openFeedbackDatabase();
    try {
      db.exec("CREATE TABLE IF NOT EXISTS operational_events (event_id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,payload TEXT NOT NULL,occurred_at TEXT NOT NULL) STRICT");
      db.prepare("INSERT OR IGNORE INTO operational_events VALUES (?,?,?,?)").run(value.eventId, viewer.userId, JSON.stringify(value), value.occurredAt);
      db.prepare("DELETE FROM operational_events WHERE occurred_at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    } finally { db.close(); }
    return { accepted: true, eventId: value.eventId };
  }
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("ingest_operational_event", { requested: value });
  if (error) throw new Error(error.message);
  return { accepted: true, eventId: value.eventId };
}

export async function readPrivacySettings(userId: string): Promise<MemberPrivacySettings> {
  if (configuredProductProvider() === "local") return readLocalDemoState(userId).privacySettings;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("member_privacy_settings");
  if (error || !data) throw new Error(error?.message || "Privacy settings are unavailable.");
  return memberPrivacySettingsSchema.parse(data);
}

export async function savePrivacySettings(userId: string, input: unknown): Promise<MemberPrivacySettings> {
  const value = memberPrivacySettingsSchema.parse(input);
  if (configuredProductProvider() === "local") {
    updateLocalDemoState(userId, (state) => ({
      ...state,
      privacySettings: value,
      leaderboardIdentity: {
        ...state.leaderboardIdentity,
        mode: value.anonymousRanking ? "anonymous" : state.leaderboardIdentity.mode === "anonymous" ? "nickname" : state.leaderboardIdentity.mode,
        realNameConsent: value.hideRealName ? false : state.leaderboardIdentity.realNameConsent,
      },
    }));
    return value;
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("update_member_privacy_settings", { requested: value });
  if (error || !data) throw new Error(error?.message || "Privacy settings could not be saved.");
  return memberPrivacySettingsSchema.parse(data);
}

function openFeedbackDatabase() {
  const db = new DatabaseSync(localDemoDatabasePath());
  db.exec(`CREATE TABLE IF NOT EXISTS product_feedback (
    id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, portal TEXT NOT NULL,
    category TEXT NOT NULL, description TEXT NOT NULL, route TEXT NOT NULL,
    ui_state_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium', assigned_to TEXT, resolution TEXT, updated_at TEXT
  ) STRICT;`);
  const columns = new Set((db.prepare("PRAGMA table_info(product_feedback)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, definition] of [["severity", "TEXT NOT NULL DEFAULT 'medium'"], ["assigned_to", "TEXT"], ["resolution", "TEXT"], ["updated_at", "TEXT"]] as const) {
    if (!columns.has(name)) db.exec(`ALTER TABLE product_feedback ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE product_feedback SET updated_at=created_at WHERE updated_at IS NULL");
  db.exec(`CREATE TABLE IF NOT EXISTS feedback_internal_notes (
    id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;`);
  return db;
}

export async function addFeedbackNote(viewer: ViewerContext, id: string, body: unknown) {
  if (!viewer.isOfficer || viewer.audience !== "officer" || !viewer.userId) throw new Error("Officer authorization required.");
  const note = z.string().trim().min(1).max(1200).parse(body);
  const value = { id: randomUUID(), feedbackId: id, authorId: viewer.userId, body: note, createdAt: new Date().toISOString() };
  if (configuredProductProvider() === "local") {
    const db = openFeedbackDatabase();
    try {
      const exists = db.prepare("SELECT 1 FROM product_feedback WHERE id=?").get(id);
      if (!exists) throw new Error("Report not found.");
      db.prepare("INSERT INTO feedback_internal_notes VALUES (?,?,?,?,?)").run(value.id,id,viewer.userId,note,value.createdAt);
    } finally { db.close(); }
    return value;
  }
  const client = await createSupabaseServerClient();
  const { error } = await client.from("feedback_internal_notes").insert({ id: value.id, feedback_id: id, author_id: viewer.userId, body: note });
  if (error) throw new Error(error.message);
  return value;
}

export async function createFeedbackReport(viewer: ViewerContext, input: unknown): Promise<FeedbackReport> {
  if (!viewer.userId && !viewer.localDevelopment) throw new Error("Authentication required.");
  const value = feedbackReportSchema.parse(input) as FeedbackReportInput;
  const report: FeedbackReport = {
    ...value,
    id: randomUUID(),
    portal: viewer.audience,
    status: "received",
    severity: value.category === "security" ? "high" : "medium",
    reporterId: viewer.userId || "local-anonymous",
    reporterLabel: viewer.audience === "officer" ? "Local Officer" : "Member #7A82F",
    assignedTo: null,
    resolution: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (configuredProductProvider() === "local") {
    const db = openFeedbackDatabase();
    try {
      db.prepare("INSERT INTO product_feedback (id,reporter_id,portal,category,description,route,ui_state_json,status,created_at,severity,assigned_to,resolution,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        report.id, viewer.userId || "local-anonymous", report.portal, report.category,
        report.description, report.route, JSON.stringify(report.uiState), report.status, report.createdAt,
        report.severity, null, null, report.updatedAt,
      );
    } finally { db.close(); }
    return report;
  }
  const client = await createSupabaseServerClient();
  const { error } = await client.from("product_feedback").insert({
    id: report.id, reporter_id: viewer.userId, portal: report.portal,
    category: report.category, description: report.description, route: report.route,
    ui_state: report.uiState, status: report.status, severity: report.severity,
  });
  if (error) throw new Error(error.message);
  return report;
}

export async function readFeedbackReports(viewer: ViewerContext): Promise<FeedbackReport[]> {
  if (!viewer.userId) return [];
  if (configuredProductProvider() === "local") {
    const db = openFeedbackDatabase();
    try {
      const rows = viewer.isOfficer
        ? db.prepare("SELECT * FROM product_feedback ORDER BY created_at DESC, id DESC LIMIT 500").all()
        : db.prepare("SELECT * FROM product_feedback WHERE reporter_id=? ORDER BY created_at DESC LIMIT 20").all(viewer.userId);
      return rows.map((row) => ({
        id: String(row.id), portal: String(row.portal) as FeedbackReport["portal"], reporterId: String(row.reporter_id),
        reporterLabel: String(row.portal) === "officer" ? "Officer" : `Member ${String(row.reporter_id).slice(0,8).toUpperCase()}`,
        category: String(row.category) as FeedbackReport["category"], description: String(row.description),
        route: String(row.route), uiState: JSON.parse(String(row.ui_state_json)),
        status: String(row.status) as FeedbackReport["status"], severity: String(row.severity || "medium") as FeedbackReport["severity"],
        assignedTo: row.assigned_to ? String(row.assigned_to) : null, resolution: row.resolution ? String(row.resolution) : null,
        createdAt: String(row.created_at), updatedAt: String(row.updated_at || row.created_at),
      }));
    } finally { db.close(); }
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("product_feedback").select("id,reporter_id,portal,category,description,route,ui_state,status,severity,assigned_to,resolution,created_at,updated_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: row.id, reporterId: row.reporter_id, reporterLabel: `Member ${row.reporter_id.slice(0,8).toUpperCase()}`,
    portal: row.portal as FeedbackReport["portal"],
    category: row.category as FeedbackReport["category"],
    description: row.description,
    route: row.route,
    uiState: row.ui_state as FeedbackReport["uiState"],
    status: row.status as FeedbackReport["status"], severity: row.severity as FeedbackReport["severity"], assignedTo: row.assigned_to,
    resolution: row.resolution, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export type FeedbackReportFilters = {
  status?: FeedbackReport["status"];
  severity?: FeedbackReport["severity"];
  portal?: FeedbackReport["portal"];
  category?: FeedbackReport["category"];
  search?: string;
  cursor?: string;
  limit?: number;
};

export async function readFeedbackReportPage(viewer: ViewerContext, filters: FeedbackReportFilters): Promise<FeedbackReportPage> {
  if (!viewer.isOfficer || viewer.audience !== "officer") throw new Error("Officer authorization required.");
  const limit = Math.min(Math.max(filters.limit || 25, 1), 100);
  const all = await readFeedbackReports(viewer);
  const search = filters.search?.trim().toLowerCase();
  const filtered = all.filter((report) =>
    (!filters.status || report.status === filters.status)
    && (!filters.severity || report.severity === filters.severity)
    && (!filters.portal || report.portal === filters.portal)
    && (!filters.category || report.category === filters.category)
    && (!filters.cursor || `${report.createdAt}|${report.id}` < filters.cursor)
    && (!search || `${report.reporterLabel} ${report.category} ${report.description} ${report.route}`.toLowerCase().includes(search))
  ).slice(0, limit + 1);
  const hasMore = filtered.length > limit;
  const items = filtered.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null };
}

export async function updateFeedbackReport(viewer: ViewerContext, id: string, input: unknown): Promise<FeedbackReport> {
  if (!viewer.isOfficer || viewer.audience !== "officer") throw new Error("Officer authorization required.");
  const value: FeedbackUpdate = feedbackUpdateSchema.parse(input);
  const updatedAt = new Date().toISOString();
  if (configuredProductProvider() === "local") {
    const db = openFeedbackDatabase();
    try {
      db.prepare("UPDATE product_feedback SET status=?,severity=?,assigned_to=?,resolution=?,updated_at=? WHERE id=?").run(value.status, value.severity, value.assignedTo, value.resolution, updatedAt, id);
    } finally { db.close(); }
  } else {
    const client = await createSupabaseServerClient();
    const { error } = await client.from("product_feedback").update({ status: value.status, severity: value.severity, assigned_to: value.assignedTo, resolution: value.resolution, updated_at: updatedAt }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  const reports = await readFeedbackReports(viewer);
  const report = reports.find((item) => item.id === id);
  if (!report) throw new Error("Report not found.");
  return report;
}

export async function readMembershipStatus(viewer: ViewerContext, forcePending = false): Promise<MembershipStatus> {
  if (forcePending && viewer.localDevelopment) return {
    state: "payment_pending", paid: false, canEnterMemberPortal: false,
    paymentReference: "DEMO-PENDING-2026", updatedAt: new Date().toISOString(), demo: true,
  };
  if (configuredProductProvider() === "local") return {
    state: "active", paid: true, canEnterMemberPortal: true,
    paymentReference: "DEMO-ACTIVE-2026", updatedAt: new Date().toISOString(), demo: true,
  };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("current_membership_status");
  if (error || !data) throw new Error(error?.message || "Membership status is unavailable.");
  return data as unknown as MembershipStatus;
}
