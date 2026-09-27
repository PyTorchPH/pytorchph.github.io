import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { localAccounts } from "./accounts.mjs";
import { assertDevelopmentRuntime, assertLocalUrl, developmentBrowserOptions } from "./policy.mjs";
import { runtimePath } from "../local-workspace/runtime-paths.mjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

assertDevelopmentRuntime();
if (supabaseUrl) assertLocalUrl(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL", ["localhost", "127.0.0.1"]);
for (const account of Object.values(localAccounts)) {
  assertLocalUrl(account.origin, "portal origin", ["localhost"]);
}
if (supabaseUrl && !supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required when Supabase auth is configured.");

function browserExecutable() {
  const candidates = [
    process.env.JOB_FINDER_BROWSER_EXECUTABLE,
    process.platform === "win32" && process.env.ProgramFiles ? resolve(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : "",
    "/opt/brave.com/brave/brave",
    "/usr/bin/brave-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function sessionCookies(account) {
  const pending = [];
  const client = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [],
      setAll: (values) => pending.push(...values),
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) {
    throw new Error(`Synthetic ${account.email} sign-in failed. Run the local Supabase seed/reset first: ${error.message}`);
  }
  return pending;
}

function playwrightCookie(value, origin) {
  const sameSite = value.options?.sameSite;
  return {
    name: value.name,
    value: value.value,
    url: origin,
    httpOnly: value.options?.httpOnly,
    secure: value.options?.secure,
    sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax",
  };
}

async function openRole(role, account) {
  const context = await chromium.launchPersistentContext(
    runtimePath("sessions", "browsers", "development", role),
    developmentBrowserOptions(browserExecutable()),
  );
  const page = context.pages()[0] || await context.newPage();
  const destination = `${account.origin}/dashboard`;
  await page.goto(destination, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/login") {
    if (supabaseUrl && supabaseKey) {
      const cookies = await sessionCookies(account);
      await context.addCookies(cookies.map((cookie) => playwrightCookie(cookie, account.origin)));
    } else {
      const response = await page.request.post(`${account.origin}/api/auth/login`, {
        data: { email: account.email, password: account.password, remember: true },
      });
      if (!response.ok()) throw new Error(`Synthetic ${role} local sign-in failed with HTTP ${response.status()}.`);
    }
    await page.goto(destination, { waitUntil: "domcontentloaded" });
  }
  console.log(`${role} ready: ${page.url()} (${account.email})`);
  return context;
}

const contexts = await Promise.all(Object.entries(localAccounts).map(([role, account]) => openRole(role, account)));
const keepAlive = setInterval(() => {}, 60_000);
const stop = async () => {
  clearInterval(keepAlive);
  await Promise.allSettled(contexts.map((context) => context.close()));
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
