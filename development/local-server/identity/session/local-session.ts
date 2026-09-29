import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LOCAL_SESSION_COOKIE = "pytorch_ph_local_session";

export type LocalAccount = { userId: string; email: string; role: "member" | "admin"; isOfficer: boolean; membershipStatus: "active"; membershipPaid: boolean };

function databasePath() {
  return process.env.PYTORCH_PH_LOCAL_DATABASE_PATH || path.resolve(process.cwd(), "../../var/state/demo/product.sqlite3");
}

function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }
function passwordHash(password: string, salt: string) { return scryptSync(password, salt, 32).toString("hex"); }

function database() {
  const filename = databasePath();
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_auth_accounts (
      user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL, is_officer INTEGER NOT NULL,
      membership_status TEXT NOT NULL, membership_paid INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS local_auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES local_auth_accounts(user_id)
    ) STRICT;
  `);
  return db;
}

export function upsertLocalAccount(value: LocalAccount & { password: string }) {
  const db = database();
  try {
    const salt = randomBytes(16).toString("hex");
    db.prepare(`INSERT INTO local_auth_accounts
      (user_id,email,password_salt,password_hash,role,is_officer,membership_status,membership_paid)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      role=excluded.role,is_officer=excluded.is_officer,membership_status=excluded.membership_status,membership_paid=excluded.membership_paid`)
      .run(value.userId, value.email, salt, passwordHash(value.password, salt), value.role, value.isOfficer ? 1 : 0, value.membershipStatus, value.membershipPaid ? 1 : 0);
  } finally { db.close(); }
}

function account(row: Record<string, unknown> | undefined): LocalAccount | null {
  if (!row) return null;
  return { userId: String(row.user_id), email: String(row.email), role: String(row.role) as LocalAccount["role"], isOfficer: Boolean(row.is_officer), membershipStatus: "active", membershipPaid: Boolean(row.membership_paid) };
}

export function authenticateLocalAccount(email: string, password: string): LocalAccount | null {
  const db = database();
  try {
    const row = db.prepare("SELECT * FROM local_auth_accounts WHERE lower(email)=lower(?)").get(email.trim()) as Record<string, unknown> | undefined;
    if (!row) return null;
    const expected = Buffer.from(String(row.password_hash), "hex");
    const actual = Buffer.from(passwordHash(password, String(row.password_salt)), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? account(row) : null;
  } finally { db.close(); }
}

export function createLocalSession(userId: string, remember: boolean) {
  const token = randomBytes(32).toString("base64url");
  const lifetime = remember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + lifetime * 1000);
  const db = database();
  try {
    db.prepare("DELETE FROM local_auth_sessions WHERE expires_at<=?").run(now.toISOString());
    db.prepare("INSERT INTO local_auth_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .run(digest(token), userId, expiresAt.toISOString(), now.toISOString());
  } finally { db.close(); }
  return { token, expiresAt, maxAge: remember ? lifetime : undefined };
}

export function readLocalSession(token: string | undefined): LocalAccount | null {
  if (!token) return null;
  const db = database();
  try {
    const row = db.prepare(`SELECT a.* FROM local_auth_sessions s JOIN local_auth_accounts a ON a.user_id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(digest(token), new Date().toISOString()) as Record<string, unknown> | undefined;
    return account(row);
  } finally { db.close(); }
}

export function revokeLocalSession(token: string | undefined) {
  if (!token) return;
  const db = database();
  try { db.prepare("DELETE FROM local_auth_sessions WHERE token_hash=?").run(digest(token)); }
  finally { db.close(); }
}
