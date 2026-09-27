import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { run, stopTogether } from "./processes.mjs";
import { runtimePath, workspaceRoot } from "./runtime-paths.mjs";

if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.CI) {
  throw new Error("The synthetic PH website preview is available only in local development.");
}
const environment = {
  ...process.env,
  PYTORCH_PH_DATA_PROVIDER: "local",
  PYTORCH_PH_LOCAL_DATABASE_PATH: runtimePath("state", "demo", "product.sqlite3"),
  PYTORCH_PH_VAR_ROOT: runtimePath(),
  PYTORCH_PH_ARTIFACT_ROOT: resolve(workspaceRoot, "out"),
  PYTORCH_PH_MEMBER_HOSTS: "members.ph.localhost:3100,localhost:3100,127.0.0.1:3100",
  PYTORCH_PH_OFFICER_HOSTS: "officers.ph.localhost:3100",
  PYTORCH_PH_MEMBER_URL: "http://members.ph.localhost:3100",
  PYTORCH_PH_OFFICER_URL: "http://officers.ph.localhost:3100",
};
for (const [script, args, cwd] of [
  [resolve(workspaceRoot, "apps/portal/scripts/demo-data.ts"), ["ensure"], resolve(workspaceRoot, "apps/portal")],
  [resolve(workspaceRoot, "development/local-access/seed-local-auth.ts"), [], workspaceRoot],
]) {
  execFileSync(process.execPath, ["--import", "tsx", script, ...args], { cwd, env: environment, stdio: "inherit" });
}
console.info(JSON.stringify({ event: "ph.preview.starting", component: "local-workspace", outcome: "started", timestamp: new Date().toISOString(), url: "http://localhost:3100", provider: "synthetic-local" }));
const portal = run("npm", ["run", "dev:portal"], { cwd: workspaceRoot, env: environment });
const stop = stopTogether([portal]);
portal.once("exit", (code) => {
  console.info(JSON.stringify({ event: "ph.preview.stopped", outcome: code === 0 ? "success" : "failure", exitCode: code }));
  stop();
  process.exitCode = code ?? 1;
});
