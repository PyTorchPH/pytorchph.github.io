import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EvidenceItem, EvidenceSource, Opportunity, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { resumeProfileFromEvidence } from "@pytorch-ph/domain-server/resumes";

type SourceState = Pick<EvidenceSource, "id" | "connectionStatus" | "lastSyncedAt" | "configuredUrl">;
type MediaRecord = { bytes: Uint8Array; mimeType: string };

function databasePath() {
  return process.env.PYTORCH_PH_LOCAL_DATABASE_PATH || path.resolve(process.cwd(), "../../var/state/demo/product.sqlite3");
}

function database() {
  const filename = databasePath();
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_evidence_items (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS product_source_states (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      connection_status TEXT NOT NULL CHECK (connection_status IN ('connected','disconnected','verification_required')),
      last_synced_at TEXT,
      configured_url TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS product_evidence_media (
      user_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, evidence_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS product_manual_opportunities (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    ) STRICT;
  `);
  const sourceColumns = db.prepare("PRAGMA table_info(product_source_states)").all();
  if (!sourceColumns.some((column) => String(column.name) === "configured_url")) {
    db.exec("ALTER TABLE product_source_states ADD COLUMN configured_url TEXT");
  }
  return db;
}

export function saveLocalOpportunity(userId: string, opportunity: Opportunity): Opportunity {
  const db = database();
  try {
    db.prepare(`INSERT INTO product_manual_opportunities (user_id,id,payload_json,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(userId, opportunity.id, JSON.stringify(opportunity), new Date().toISOString());
    return opportunity;
  } finally { db.close(); }
}

export function listLocalOpportunities(userId: string): Opportunity[] {
  const db = database();
  try {
    return db.prepare("SELECT payload_json FROM product_manual_opportunities WHERE user_id=? ORDER BY updated_at DESC").all(userId)
      .flatMap((row) => { try { return [JSON.parse(String(row.payload_json)) as Opportunity]; } catch { return []; } });
  } finally { db.close(); }
}

export function saveLocalEvidence(userId: string, item: EvidenceItem): EvidenceItem {
  const db = database();
  try {
    db.prepare(`INSERT INTO product_evidence_items (user_id,id,payload_json,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(userId, item.id, JSON.stringify(item), new Date().toISOString());
    return item;
  } finally {
    db.close();
  }
}

export function createLocalEvidence(userId: string, item: Omit<EvidenceItem, "id">): EvidenceItem {
  return saveLocalEvidence(userId, { ...item, id: randomUUID() });
}

export function listLocalEvidence(userId: string): EvidenceItem[] {
  const db = database();
  try {
    return db.prepare("SELECT payload_json FROM product_evidence_items WHERE user_id=? ORDER BY updated_at DESC")
      .all(userId)
      .flatMap((row) => {
        try {
          return [JSON.parse(String(row.payload_json)) as EvidenceItem];
        } catch {
          return [];
        }
      });
  } finally {
    db.close();
  }
}

export function saveLocalMedia(userId: string, evidenceId: string, bytes: Uint8Array, mimeType: string) {
  const db = database();
  try {
    db.prepare(`INSERT INTO product_evidence_media (user_id,evidence_id,mime_type,bytes,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id,evidence_id) DO UPDATE SET mime_type=excluded.mime_type,bytes=excluded.bytes,updated_at=excluded.updated_at`)
      .run(userId, evidenceId, mimeType, bytes, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function readLocalMedia(userId: string, evidenceId: string): MediaRecord | null {
  const db = database();
  try {
    const row = db.prepare("SELECT mime_type,bytes FROM product_evidence_media WHERE user_id=? AND evidence_id=?").get(userId, evidenceId);
    if (!row) return null;
    return { mimeType: String(row.mime_type), bytes: row.bytes as Uint8Array };
  } finally {
    db.close();
  }
}

export function saveLocalSourceState(userId: string, state: SourceState): SourceState {
  const db = database();
  try {
    db.prepare(`INSERT INTO product_source_states (user_id,id,connection_status,last_synced_at,configured_url,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET connection_status=excluded.connection_status,last_synced_at=excluded.last_synced_at,configured_url=excluded.configured_url,updated_at=excluded.updated_at`)
      .run(userId, state.id, state.connectionStatus || "disconnected", state.lastSyncedAt || null, state.configuredUrl || null, new Date().toISOString());
    return state;
  } finally {
    db.close();
  }
}

export function listLocalSourceStates(userId: string): SourceState[] {
  const db = database();
  try {
    return db.prepare("SELECT id,connection_status,last_synced_at,configured_url FROM product_source_states WHERE user_id=?")
      .all(userId)
      .map((row) => ({ id: String(row.id), connectionStatus: String(row.connection_status) as SourceState["connectionStatus"], lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null, configuredUrl: row.configured_url ? String(row.configured_url) : null }));
  } finally {
    db.close();
  }
}

export function overlayLocalCareerState(data: ProductViewData, userId: string): ProductViewData {
  const storedItems = listLocalEvidence(userId);
  const baseItems = data.evidence?.items || [];
  const storedById = new Map(storedItems.map((item) => [item.id, item]));
  const items = [...baseItems.map((item) => storedById.get(item.id) || item), ...storedItems.filter((item) => !baseItems.some((base) => base.id === item.id))];
  const stateById = new Map(listLocalSourceStates(userId).map((state) => [state.id, state]));
  const sources = (data.evidence?.sources || []).map((source) => {
    const state = stateById.get(source.id);
    if (!state) return source;
    return { ...source, ...state, status: state.connectionStatus === "connected" ? "verified" as const : state.connectionStatus === "verification_required" ? "blocked" as const : "ready" as const };
  });
  const resumeProfile = resumeProfileFromEvidence(items, data.resumeProfile);
  const manualOpportunities = listLocalOpportunities(userId);
  const manualById = new Map(manualOpportunities.map((item) => [item.id, item]));
  const opportunities = [...(data.opportunities || []).map((item) => manualById.get(item.id) || item), ...manualOpportunities.filter((item) => !(data.opportunities || []).some((base) => base.id === item.id))];
  return {
    ...data,
    evidence: data.evidence ? { ...data.evidence, items, sources } : data.evidence,
    resumeProfile: resumeProfile || data.resumeProfile,
    opportunities,
  };
}
