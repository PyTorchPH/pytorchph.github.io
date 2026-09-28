import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { PORTAL_BASE_PATH } from "./portal-base-path.mjs";

// Serves the Pages layout: the public site (site/_site, when built) at / and the portal demo under /portal/.
const root = resolve(import.meta.dirname, "../..");
const portalOut = resolve(root, "apps/pages-demo/out");
const siteOut = resolve(root, "site/_site");
assert.ok(existsSync(resolve(portalOut, ".nojekyll")), "Run npm run build:pages first.");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const fileFor = pathname => {
  const [dir, rest] = pathname.startsWith(`${PORTAL_BASE_PATH}/`) ? [portalOut, pathname.slice(PORTAL_BASE_PATH.length + 1)] : [siteOut, pathname.slice(1)];
  if (rest.includes("..")) return null;
  for (const candidate of [rest, `${rest}index.html`, `${rest}/index.html`]) {
    const path = resolve(dir, candidate);
    if (path.startsWith(dir) && existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
};
const server = createServer((request, response) => {
  const path = fileFor(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
  if (!path) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
  response.end(readFileSync(path));
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}${PORTAL_BASE_PATH}`;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const schoolText = /\b(?:FEU|Far Eastern|Tamaraw|SADO|campus|students?|university|faculty|college)\b|fit\.edu/i;
const memberHeading = "My performance";
const officerHeading = "Community intelligence dashboard for chapter operations.";
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PH_DEMO_BROWSER || (existsSync(chrome) ? chrome : undefined) });
  // The product tour starts on a first visit and covers the page; first check it, then run the rest with tours seen.
  const firstVisit = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const demoSeed = readFileSync(resolve(root, "apps/api/seeds/demo-fixtures.json"));
  await firstVisit.route("https://api.pytorch.ph/demo/fixtures", route => route.fulfill({ status: 200, contentType: "application/json", body: demoSeed }));
  const tourPage = await firstVisit.newPage();
  await tourPage.goto(`${url}/dashboard/`, { waitUntil: "networkidle" });
  await tourPage.getByText("Your performance dashboard", { exact: true }).waitFor();
  await tourPage.keyboard.press("Escape");
  await tourPage.getByText("Your performance dashboard", { exact: true }).waitFor({ state: "detached" });
  await firstVisit.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let demoApiRequests = 0;
  await context.route("https://api.pytorch.ph/demo/fixtures", route => {
    demoApiRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: demoSeed });
  });
  await context.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) { return String(key).startsWith("pytorch-ph:tour:") ? "seen" : read.call(this, key); };
  });
  const page = await context.newPage();
  const errors = [], externalRequests = [], missingAssets = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== origin) externalRequests.push(request.url()); });
  page.on("response", response => {
    const { pathname } = new URL(response.url());
    if (response.status() >= 400 && !pathname.startsWith("/api/") && pathname !== "/favicon.ico" && pathname.startsWith(PORTAL_BASE_PATH)) missingAssets.push(`${response.status()} ${pathname}`);
  });
  const heading = name => page.getByRole("heading", { name, exact: true }).first().waitFor();

  // The portal root forwards to the login screen.
  await page.goto(`${url}/`, { waitUntil: "networkidle" });
  await page.waitForURL(`**${PORTAL_BASE_PATH}/login/`);
  await page.waitForLoadState("networkidle");
  assert.match(await page.title(), /PyTorch Philippines.*Demo/);

  // Example controls on the login page enter both portal views without fixed banners.
  await page.getByRole("region", { name: "Example accounts" }).waitFor();
  await page.getByRole("button", { name: "Use example member", exact: true }).click();
  await heading(memberHeading);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Career Evidence" }).first().waitFor();
  await page.getByRole("columnheader", { name: "Peer median" }).waitFor();
  await page.getByRole("button", { name: "How ranking works" }).click();
  await page.getByText("How to raise your rank", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  // Officers share My Performance and see the officer desk and the officer tools in addition.
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Use example officer", exact: true }).click();
  await heading(memberHeading);
  await heading("Officer desk");
  await page.reload({ waitUntil: "networkidle" });
  await heading("Officer desk");
  await page.getByRole("link", { name: "Command Center" }).first().click();
  await heading(officerHeading);
  assert.equal(await page.getByText("Elite node rank", { exact: true }).count(), 0, "The command center must not repeat the leaderboard");
  await page.getByRole("link", { name: "Event Workflow" }).first().click();
  await heading("Event workflow");
  for (const stage of ["1. Create an event", "2. Department approval", "3. Auto emailer", "4. Final approval"]) await heading(stage);
  await page.getByRole("button", { name: "Approve this exact text" }).waitFor();

  // The portal login form works with an example account and never contacts a backend.
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await heading("Welcome back, builder.");
  await page.locator('input[type="email"]').first().fill("demo.member@example.org");
  await page.locator('input[type="password"]').first().fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await heading(memberHeading);
  assert.ok(new URL(page.url()).pathname.startsWith(PORTAL_BASE_PATH), "Navigation must stay under the portal base path");
  assert.equal(await page.getByRole("heading", { name: "Officer desk", exact: true }).count(), 0, "Members must not see the officer desk");
  assert.equal(await page.getByRole("link", { name: "Command Center" }).count(), 0, "Members must not see officer tools");

  // Job analytics and job automation sit under Resumes & Opportunities for members too.
  await page.goto(`${url}/career/resumes/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Job analytics", exact: true }).click();
  await heading("Job Market Analytics");
  await page.getByRole("button", { name: "Job automation", exact: true }).waitFor();

  // Settings holds account binding and privacy for everyone; binding needs the browser extension.
  await page.goto(`${url}/settings/`, { waitUntil: "networkidle" });
  await page.getByText("Connected accounts", { exact: true }).waitFor();
  await page.getByText("Not installed", { exact: true }).waitFor();
  await page.getByRole("link", { name: "How to install" }).click();
  await heading("Install the Evidence Collector");
  // Every logo opens the pytorch.ph landing page.
  assert.equal(await page.getByRole("link", { name: "PyTorch PH: go to the pytorch.ph home page" }).first().getAttribute("href"), "https://pytorch.ph/");
  await page.goto(`${url}/settings/`, { waitUntil: "networkidle" });
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(manifest.display, "standalone");

  // Writes are answered locally with a read-only notice.
  const write = await page.evaluate(() => fetch("/api/feedback", { method: "POST", body: "{}" }).then(response => response.status));
  assert.equal(write, 403);

  const routes = ["/login/", "/register/", "/dashboard/", "/dashboard/profile/", "/dashboard/community/", "/community-preview/", "/career/evidence/", "/career/resumes/", "/jobs/opportunities/", "/jobs/analytics/", "/jobs/automation/", "/events/", "/leaderboards/", "/membership/", "/trust/", "/settings/", "/setup/evidence-extension/"];
  for (const path of routes) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.locator('aside[aria-label="Demo notice"], .on-dark.fixed.inset-x-0.top-0').count(), 0, `Fixed demo banner on ${path}`);
    assert.doesNotMatch(await page.locator("body").innerText(), schoolText, `School-specific text on ${path}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/login/", "/dashboard/", "/events/", "/leaderboards/"]) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Mobile overflow: ${path}`);
  }
  assert.deepEqual(await context.cookies(), []);
  assert.ok(demoApiRequests > 0, "Demo views must request the backend snapshot");
  assert.deepEqual(externalRequests.filter(request => !/fonts\.(googleapis|gstatic)\.com/.test(request) && request !== "https://api.pytorch.ph/demo/fixtures"), []);
  assert.deepEqual(missingAssets, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ event: "pages_demo.verify.completed", outcome: "success", checks: ["product-tour", "portal-entry-redirect", "peer-scorecard", "ranking-guide", "shared-dashboard", "officer-desk", "event-workflow", "member-job-tools", "account-binding", "logo-landing", "installable-app", "login-example-member", "login-example-officer", "no-fixed-demo-banners", "officer-persists-reload", "portal-login", "base-path", "read-only-writes", "static-routes", "no-school-text", "mobile", "no-auth-cookies", "backend-demo-snapshot", "no-unapproved-external-requests", "no-missing-assets", "no-page-errors"] }));
} finally {
  await browser?.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
