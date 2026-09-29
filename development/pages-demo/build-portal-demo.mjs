import { spawnSync } from "node:child_process";
import { PORTAL_BASE_PATH } from "./portal-base-path.mjs";

// Builds the static portal for the Pages workflow.
// --production-api builds exactly like CI (official API origin), overriding a local .env.local,
// because process environment variables take precedence over Next.js .env files.
const PRODUCTION_API_ORIGIN = "https://api.pytorch.ph";
const productionApi = process.argv.includes("--production-api")
  ? { NEXT_PUBLIC_AUTH_API_ORIGIN: PRODUCTION_API_ORIGIN, NEXT_PUBLIC_API_ORIGIN: PRODUCTION_API_ORIGIN }
  : {};

const result = spawnSync("npm", ["run", "build", "--workspace", "@pytorch-ph/pages-demo"], {
  env: { ...process.env, ...productionApi, PAGES_BASE_PATH: PORTAL_BASE_PATH },
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exitCode = result.status ?? 1;
