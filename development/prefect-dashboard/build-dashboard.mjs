import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { commandInvocation } from "../local-workspace/processes.mjs";
import { runtimePath, workspaceRoot as root } from "../local-workspace/runtime-paths.mjs";

const source = runtimePath("cache", "process-lab", "prefect-ui-source");
const output = runtimePath("cache", "process-lab", "prefect-ui", "v2");
const marker = resolve(source, ".pytorch-ph-patch");
const patch = resolve(import.meta.dirname, "patches/prefect-3.8.3-joyride.patch");
const expectedCommit = "d8f54b5c4857e933c31aac97e8ef56ea732c5138";
const patchHash = createHash("sha256").update(readFileSync(patch)).digest("hex");

function command(name, args, cwd = root) {
  const invocation = commandInvocation(name, args);
  execFileSync(invocation.command, invocation.args, { cwd, stdio: "inherit" });
}

function cloneSource() {
  mkdirSync(runtimePath("cache", "process-lab"), { recursive: true });
  command("git", ["clone", "--depth", "1", "--branch", "3.8.3", "https://github.com/PrefectHQ/prefect.git", source]);
}

if (!existsSync(resolve(source, ".git"))) cloneSource();
const actualCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
if (actualCommit !== expectedCommit) {
  throw new Error(`Refusing Prefect UI patch: expected ${expectedCommit}, received ${actualCommit}.`);
}
if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== patchHash) {
  if (existsSync(marker)) {
    throw new Error("The tracked Prefect patch changed. Remove var/cache/process-lab/prefect-ui-source and rerun setup.");
  }
  command("git", ["apply", "--check", patch], source);
  command("git", ["apply", patch], source);
  writeFileSync(marker, `${patchHash}\n`);
}

const ui = resolve(source, "ui-v2");
if (existsSync(resolve(output, "index.html"))) {
  console.log(`Pinned Prefect 3.8.3 dashboard cache reused: ${output}`);
} else {
  if (!existsSync(resolve(ui, "node_modules/react-joyride"))) {
    command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], ui);
  }
  command("npm", ["run", "build"], ui);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(resolve(ui, "dist"), output, { recursive: true });
  console.log(`Pinned Prefect 3.8.3 dashboard ready: ${output}`);
}
