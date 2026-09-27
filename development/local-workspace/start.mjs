import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { commandInvocation, run, stopTogether, waitFor } from "./processes.mjs";
import { runtimePath, workspaceRoot as root } from "./runtime-paths.mjs";

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  throw new Error("The local workspace cannot run in production or Vercel.");
}

const python = runtimePath("environments", "process-lab", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const supabasePrefix = ["--yes", "supabase@latest"];
const manual = process.argv.includes("--manual-login");
const supabaseProvider = process.argv.includes("--supabase");

let status = "";
if (supabaseProvider) {
  const supabaseStart = commandInvocation("npx", [...supabasePrefix, "start"]);
  execFileSync(supabaseStart.command, supabaseStart.args, { cwd: root, stdio: ["inherit", "ignore", "inherit"] });
  const supabaseStatus = commandInvocation("npx", [...supabasePrefix, "status", "-o", "env"]);
  status = execFileSync(supabaseStatus.command, supabaseStatus.args, { cwd: root, encoding: "utf8" });
}
const values = Object.fromEntries(status.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const environment = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY || "",
  PYTORCH_PH_DATA_PROVIDER: supabaseProvider ? "supabase" : "local",
  PYTORCH_PH_MEMBER_HOSTS: "members.ph.localhost:3100,localhost:3100,127.0.0.1:3100",
  PYTORCH_PH_OFFICER_HOSTS: "officers.ph.localhost:3100",
  PYTORCH_PH_MEMBER_URL: "http://members.ph.localhost:3100",
  PYTORCH_PH_OFFICER_URL: "http://officers.ph.localhost:3100",
  PYTORCH_PH_NO_BROWSER: "1",
  PYTORCH_PH_VAR_ROOT: runtimePath(),
  PYTORCH_PH_ARTIFACT_ROOT: resolve(root, "out"),
  PYTORCH_PH_LOCAL_DATABASE_PATH: runtimePath("state", "demo", "product.sqlite3"),
  PREFECT_API_URL: "http://127.0.0.1:4200/api",
  PREFECT_HOME: runtimePath("state", "process-lab", "prefect"),
  PREFECT_UI_STATIC_DIRECTORY: runtimePath("cache", "process-lab", "prefect-ui"),
  PREFECT_SERVER_UI_V2_ENABLED: "true",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};
mkdirSync(environment.PREFECT_HOME, { recursive: true });

if (!supabaseProvider) {
  execFileSync("node", ["--import", "tsx", resolve(root, "development/local-access/seed-local-auth.ts")], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
}

execFileSync("node", [resolve(root, "development/prefect-dashboard/build-dashboard.mjs")], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

const processes = [
  run("npm", ["run", "dev:portal"], { cwd: root, env: environment }),
  run(python, ["-m", "prefect", "server", "start", "--host", "127.0.0.1"], { cwd: root, env: environment }),
];
const stop = stopTogether(processes);
try {
  await Promise.all([
    waitFor("http://members.ph.localhost:3100/login"),
    waitFor("http://127.0.0.1:4200/api/health"),
  ]);
  const lab = runtimePath("environments", "process-lab", process.platform === "win32" ? "Scripts/pytorch-ph-process-lab.exe" : "bin/pytorch-ph-process-lab");
  execFileSync(lab, ["configure"], { cwd: root, env: environment, stdio: "inherit" });
  execFileSync(lab, ["open", "--workflow", "member-experience"], { cwd: root, env: environment, stdio: "inherit" });
  if (!manual) processes.push(run("node", [resolve(root, "development/local-access/watch-login.mjs")], { cwd: root, env: environment }));
  await new Promise((resolvePromise) => processes[0].once("exit", resolvePromise));
} finally {
  stop();
}
