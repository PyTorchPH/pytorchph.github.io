import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const artifacts = JSON.parse(readFileSync(resolve(import.meta.dirname, "artifacts.json"), "utf8"));
assert.ok(Object.hasOwn(artifacts, ".nojekyll"));
assert.ok(!Object.keys(artifacts).some(name => /(?:^|\/)(?:api|node_modules|var|supabase)(?:\/|$)|\.map$/.test(name)));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml" };
const server = createServer((request, response) => {
  let name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
  if (!name || name.endsWith("/")) name += "index.html";
  if (!Object.hasOwn(artifacts, name)) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Content-Type": mime[extname(name)] || "application/octet-stream" });
  response.end(readFileSync(resolve(root, name)));
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const url = `http://127.0.0.1:${server.address().port}`;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const schoolText = /\b(?:FEU|Far Eastern|Tamaraw|SADO|campus|students?|university|faculty|college)\b|fit\.edu/i;
const memberHeading = "Your evidence, momentum, and next move.";
const officerHeading = "Community intelligence dashboard for chapter operations.";
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PH_DEMO_BROWSER || (existsSync(chrome) ? chrome : undefined) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [], externalRequests = [], missingAssets = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== url) externalRequests.push(request.url()); });
  page.on("response", response => { if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith("/api/")) missingAssets.push(`${response.status()} ${response.url()}`); });
  const heading = name => page.getByRole("heading", { name, exact: true }).first().waitFor();

  await page.goto(url, { waitUntil: "networkidle" });
  assert.match(await page.title(), /PyTorch Philippines.*Demo/);

  // Demo bar enters the real portal views as the example member, then the example officer.
  await page.getByRole("button", { name: "Use example member", exact: true }).click();
  await heading(memberHeading);
  await page.getByRole("link", { name: "Career Evidence" }).first().waitFor();
  await page.getByRole("button", { name: "Use example officer", exact: true }).click();
  await heading(officerHeading);
  await page.reload({ waitUntil: "networkidle" });
  await heading(officerHeading);
  await page.getByRole("link", { name: "Command Center" }).first().waitFor();

  // The portal login form works with an example account and never contacts a backend.
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await heading("Welcome back, builder.");
  await page.locator('input[type="email"]').first().fill("demo.member@example.org");
  await page.locator('input[type="password"]').first().fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await heading(memberHeading);

  // Writes are answered locally with a read-only notice.
  const write = await page.evaluate(() => fetch("/api/feedback", { method: "POST", body: "{}" }).then(response => response.status));
  assert.equal(write, 403);

  const routes = ["/", "/login/", "/register/", "/dashboard/", "/dashboard/profile/", "/career/evidence/", "/career/resumes/", "/jobs/opportunities/", "/events/", "/leaderboards/", "/membership/", "/trust/", "/settings/"];
  for (const path of routes) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    await page.getByRole("complementary", { name: "Demo notice" }).waitFor();
    if (path !== "/") assert.doesNotMatch(await page.locator("body").innerText(), schoolText, `School-specific text on ${path}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/login/", "/dashboard/", "/events/", "/leaderboards/"]) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Mobile overflow: ${path}`);
  }
  assert.deepEqual(await context.cookies(), []);
  assert.deepEqual(externalRequests.filter(request => !/fonts\.(googleapis|gstatic)\.com/.test(request)), []);
  assert.deepEqual(missingAssets, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ event: "pages_demo.verify.completed", outcome: "success", checks: ["demo-bar-member", "demo-bar-officer", "officer-persists-reload", "portal-login", "read-only-writes", "static-routes", "no-school-text", "mobile", "no-auth-cookies", "no-external-requests", "no-missing-assets", "no-page-errors"] }));
} finally {
  await browser?.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
