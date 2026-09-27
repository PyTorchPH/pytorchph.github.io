import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { runtimePath, workspaceRoot as root } from "./runtime-paths.mjs";

const mappings = [
  [".cache/process-lab/prefect-ui-source", runtimePath("cache", "process-lab", "prefect-ui-source")],
  [".cache/process-lab/prefect-ui", runtimePath("cache", "process-lab", "prefect-ui")],
  [".cache/process-lab/venv", runtimePath("environments", "process-lab")],
  [".cache/process-lab/prefect", runtimePath("state", "process-lab", "prefect")],
  [".cache/application-submissions.sqlite3", runtimePath("state", "job-applications", "submissions.sqlite3")],
  [".cache/application-verification-queue.json", runtimePath("state", "job-applications", "verification-queue.json")],
  [".cache/indeed-event-watcher-state.json", runtimePath("state", "job-applications", "indeed-event-watcher.json")],
  [".cache/.indeed-event-watcher-ready", runtimePath("run", "job-applications", "indeed-event-watcher-ready")],
  [".cache/application-submissions.sqlite3.bak-20260724-171505", runtimePath("state", "job-applications", "backups", "submissions-20260724-171505.sqlite3")],
  [".cache/binance-bap-approved-answers.json", runtimePath("state", "job-applications", "binance-bap-approved-answers.json")],
  [".cache/binance-current-manifest.json", runtimePath("state", "job-applications", "binance-current-manifest.json")],
  [".cache/indeed-event-resume-5DC239AE045BBACF64EB6475FDF6FBBE.json", runtimePath("state", "job-applications", "event-resume-5DC239AE045BBACF64EB6475FDF6FBBE.json")],
  [".cache/indeed-event-resume-67AC7437428E1B5203377F19AC4718BF.json", runtimePath("state", "job-applications", "event-resume-67AC7437428E1B5203377F19AC4718BF.json")],
  [".cache/application-layout-rules", runtimePath("cache", "job-applications", "layout-rules")],
  [".cache/demo", runtimePath("state", "demo")],
  [".cache/product-development.sqlite3", runtimePath("state", "demo", "product-development.sqlite3")],
  [".cache/job-market.sqlite3", runtimePath("state", "job-market", "job-market.sqlite3")],
  [".cache/job-finder-chrome-profile", runtimePath("sessions", "browsers", "job-finder")],
  [".careerlens-chrome-cdp", runtimePath("sessions", "browsers", "career-lens")],
  ["out/application-browser-profile", runtimePath("sessions", "browsers", "job-applications")],
].map(([source, destination]) => [resolve(root, source), destination]);

function inventory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return { files: 1, bytes: stat.size };
  return readdirSync(path, { withFileTypes: true }).reduce(
    (total, entry) => {
      if (entry.isSymbolicLink()) return total;
      const child = inventory(resolve(path, entry.name));
      return { files: total.files + child.files, bytes: total.bytes + child.bytes };
    },
    { files: 0, bytes: 0 },
  );
}

function assertProfileInactive(path) {
  const lock = resolve(path, "SingletonLock");
  try {
    const target = readlinkSync(lock);
    const match = target.match(/-(\d+)$/);
    if (!match) throw new Error(`Cannot prove browser profile is inactive: ${path}`);
    try {
      process.kill(Number(match[1]), 0);
      throw new Error(`Browser profile is active (PID ${match[1]}): ${path}`);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EINVAL") throw error;
  }
}

function verifySqlite(path) {
  if (![".sqlite", ".sqlite3", ".db"].includes(extname(path))) return;
  execFileSync("python3", [
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); assert c.execute('PRAGMA quick_check').fetchone()[0]=='ok'; c.close()",
    path,
  ], { stdio: "ignore" });
}

function repairMovedEnvironment(source, destination) {
  if (!destination.includes(`${runtimePath("environments")}/`)) return;
  const replacements = new Map([
    [source, destination],
    [resolve(root, "src"), resolve(root, "legacy/python")],
    [resolve(root, "tools/process_lab"), resolve(root, "development/process-lab")],
  ]);
  const candidates = [resolve(destination, "pyvenv.cfg")];
  const bin = resolve(destination, process.platform === "win32" ? "Scripts" : "bin");
  for (const entry of readdirSync(bin, { withFileTypes: true })) {
    if (entry.isFile()) candidates.push(resolve(bin, entry.name));
  }
  const packageRoots = [];
  const unixLib = resolve(destination, "lib");
  if (existsSync(unixLib)) {
    for (const version of readdirSync(unixLib, { withFileTypes: true })) {
      if (version.isDirectory() && version.name.startsWith("python")) {
        packageRoots.push(resolve(unixLib, version.name, "site-packages"));
      }
    }
  }
  const windowsPackages = resolve(destination, "Lib", "site-packages");
  if (existsSync(windowsPackages)) packageRoots.push(windowsPackages);
  for (const packages of packageRoots) {
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".pth")) candidates.push(resolve(packages, entry.name));
    }
  }
  for (const path of candidates) {
    const original = readFileSync(path);
    if (original.includes(0)) continue;
    let updated = original.toString("utf8");
    for (const [before, after] of replacements) updated = updated.replaceAll(before, after);
    if (updated !== original.toString("utf8")) writeFileSync(path, updated);
  }
  const python = resolve(bin, process.platform === "win32" ? "python.exe" : "python");
  execFileSync(python, ["-c", "import process_lab, resume_builder"], { stdio: "ignore" });
}

const apply = process.argv.includes("--apply");
for (const [source, destination] of mappings) {
  try {
    statSync(source);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  try {
    statSync(destination);
    throw new Error(`Destination already exists; refusing to merge: ${destination}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (source.includes("chrome") || source.includes("browser-profile")) assertProfileInactive(source);
  const before = inventory(source);
  console.log(`${apply ? "MOVE" : "PLAN"} ${source} -> ${destination} (${before.files} files, ${before.bytes} bytes)`);
  if (!apply) continue;
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
  const after = inventory(destination);
  if (before.files !== after.files || before.bytes !== after.bytes) {
    renameSync(destination, source);
    throw new Error(`Verification failed; restored source: ${source}`);
  }
  try {
    repairMovedEnvironment(source, destination);
    verifySqlite(destination);
  } catch (error) {
    renameSync(destination, source);
    throw new Error(`SQLite verification failed; restored source: ${source}`, { cause: error });
  }
}

if (!apply) console.log("Dry run only. Re-run with --apply after reviewing every path.");
