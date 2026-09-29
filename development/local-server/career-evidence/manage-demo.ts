import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureLocalDemo, localDemoDatabasePath } from "./read-demo-state";

export function localDemoStatus(userId: string) {
  const filename = localDemoDatabasePath();
  if (!existsSync(filename)) return { seeded: false, filename, seedVersion: null };
  ensureLocalDemo(userId);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const version = db.prepare("SELECT value FROM demo_metadata WHERE key='seed_version'").get();
    return { seeded: true, filename, seedVersion: Number(version?.value || 0) };
  } finally {
    db.close();
  }
}

export function resetLocalDemo(userId: string) {
  const filename = localDemoDatabasePath();
  let backup: string | null = null;
  if (existsSync(filename)) {
    const backupDirectory = path.join(path.dirname(filename), "backups");
    mkdirSync(backupDirectory, { recursive: true });
    backup = path.join(backupDirectory, `product-${new Date().toISOString().replaceAll(":", "-")}.sqlite3`);
    copyFileSync(filename, backup);
    unlinkSync(filename);
  }
  ensureLocalDemo(userId);
  return { filename, backup };
}
