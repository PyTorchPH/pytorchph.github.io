import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { run, stopTogether, waitFor } from "./processes.mjs";
import { runtimePath, workspaceRoot as root } from "./runtime-paths.mjs";

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  throw new Error("The local workspace cannot run in production or Vercel.");
}

const python = runtimePath("environments", "process-lab", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const environment = {
  ...process.env,
  PYTORCH_PH_DATA_PROVIDER: "local",
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

execFileSync("node", ["--import", "tsx", resolve(root, "development/local-access/seed-local-auth.ts")], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

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
  await new Promise((resolvePromise) => processes[0].once("exit", resolvePromise));
} finally {
  stop();
}
