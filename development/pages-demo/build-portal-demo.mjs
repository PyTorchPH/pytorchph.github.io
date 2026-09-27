import { spawnSync } from "node:child_process";
import { PORTAL_BASE_PATH } from "./portal-base-path.mjs";

// Builds the static portal demo for the Pages workflow.
const result = spawnSync("npm", ["run", "build", "--workspace", "@pytorch-ph/pages-demo"], {
  env: { ...process.env, PAGES_BASE_PATH: PORTAL_BASE_PATH },
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exitCode = result.status ?? 1;
