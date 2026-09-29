import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LOCAL_DEMO_SEED_VERSION = 1;

export type DemoRuntimeState = {
  opportunityStages: Record<string, string>;
  approvedReviewIds: string[];
  registeredEventIds: string[];
  leaderboardIdentity: {
    username: string;
    mode: "nickname" | "anonymous" | "real_name";
    realNameConsent: boolean;
    reviewRequired: boolean;
  };
  privacySettings: {
    hideGoogleIdentity: boolean;
    hideRealName: boolean;
    deviceCacheEnabled: boolean;
    anonymousRanking: boolean;
    automaticErrorReports: boolean;
  };
};

const initialState = (): DemoRuntimeState => ({
  opportunityStages: {},
  approvedReviewIds: [],
  registeredEventIds: ["event-ignite"],
  leaderboardIdentity: { username: "Alex_Rivera", mode: "nickname", realNameConsent: false, reviewRequired: false },
  privacySettings: {
    hideGoogleIdentity: true,
    hideRealName: true,
    deviceCacheEnabled: true,
    anonymousRanking: false,
    automaticErrorReports: true,
  },
});

export function localDemoDatabasePath() {
  return process.env.PYTORCH_PH_LOCAL_DATABASE_PATH
    || path.resolve(process.cwd(), "../../var/state/demo/product.sqlite3");
}

function openDatabase() {
  const filename = localDemoDatabasePath();
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS demo_runtime_state (
      user_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT OR IGNORE INTO demo_metadata (key,value) VALUES ('seed_version',?)")
    .run(String(LOCAL_DEMO_SEED_VERSION));
  return db;
}

export function ensureLocalDemo(userId: string) {
  const db = openDatabase();
  try {
    const version = db.prepare("SELECT value FROM demo_metadata WHERE key='seed_version'").get();
    if (Number(version?.value || 0) !== LOCAL_DEMO_SEED_VERSION) {
      throw new Error(`Local demo seed version mismatch: found ${version?.value || "unknown"}, expected ${LOCAL_DEMO_SEED_VERSION}. Run the guarded reset command.`);
    }
    db.prepare("INSERT OR IGNORE INTO demo_runtime_state (user_id,payload_json,updated_at) VALUES (?,?,?)")
      .run(userId, JSON.stringify(initialState()), new Date().toISOString());
  } finally {
    db.close();
  }
}

export function readLocalDemoState(userId: string): DemoRuntimeState {
  ensureLocalDemo(userId);
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT payload_json FROM demo_runtime_state WHERE user_id=?").get(userId);
    if (!row) return initialState();
    const parsed = JSON.parse(String(row.payload_json)) as Partial<DemoRuntimeState>;
    return {
      opportunityStages: parsed.opportunityStages || {},
      approvedReviewIds: parsed.approvedReviewIds || [],
      registeredEventIds: parsed.registeredEventIds || [],
      leaderboardIdentity: parsed.leaderboardIdentity || initialState().leaderboardIdentity,
      privacySettings: parsed.privacySettings || initialState().privacySettings,
    };
  } finally {
    db.close();
  }
}

export function saveLocalDemoState(userId: string, state: DemoRuntimeState) {
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO demo_runtime_state (user_id,payload_json,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at")
      .run(userId, JSON.stringify(state), new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateLocalDemoState(userId: string, update: (state: DemoRuntimeState) => DemoRuntimeState) {
  const state = update(readLocalDemoState(userId));
  saveLocalDemoState(userId, state);
  return state;
}
