import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const artifacts = JSON.parse(readFileSync(resolve(import.meta.dirname, "artifacts.json"), "utf8"));
assert.ok(Object.hasOwn(artifacts, ".nojekyll"));
assert.ok(!Object.keys(artifacts).some(name => /(?:^|\/)(?:api|node_modules|var|supabase)(?:\/|$)|\.map$/.test(name)));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".woff2": "font/woff2" };
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
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PH_DEMO_BROWSER || (existsSync(chrome) ? chrome : undefined) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [], forbiddenRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method()) || new URL(request.url()).pathname.startsWith("/api/") || request.url().includes("supabase.co")) forbiddenRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto(url, { waitUntil: "networkidle" });
  assert.match(await page.title(), /PyTorch Philippines.*Demo/);
  await page.getByRole("link", { name: "Join PyTorch Philippines", exact: true }).click();
  await page.getByRole("heading", { name: "Create a demo account" }).waitFor();
  assert.equal(await page.getByLabel("Example email", { exact: true }).inputValue(), "demo.member@example.org");
  assert.equal(await page.getByLabel("Example email", { exact: true }).getAttribute("readonly"), "");
  await page.getByRole("button", { name: "Create demo account", exact: true }).click();
  await page.getByRole("heading", { name: "Your evidence, momentum, and next move." }).waitFor();
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Use example officer", exact: true }).click();
  await page.getByRole("heading", { name: "Community intelligence dashboard for chapter operations." }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Community intelligence dashboard for chapter operations." }).waitFor();
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Use example member", exact: true }).click();
  await page.getByRole("heading", { name: "Your evidence, momentum, and next move." }).waitFor();
  await page.getByRole("navigation", { name: "Demo workspace" }).getByRole("link", { name: "Events", exact: true }).click();
  await page.getByLabel("Find a sample event").fill("NLP");
  assert.equal(await page.getByRole("button", { name: "Preview RSVP" }).count(), 1);
  await page.getByRole("button", { name: "Preview RSVP" }).click();
  await page.getByRole("status").filter({ hasText: "No registration was submitted" }).waitFor();
  await page.goto(`${url}/leaderboards/`, { waitUntil: "networkidle" });
  await page.getByLabel("Filter by name or specialty").fill("Computer Vision");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/login/", "/register/", "/dashboard/", "/admin/dashboard/", "/events/", "/leaderboards/"]) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Mobile overflow: ${path}`);
    await page.getByRole("complementary", { name: "Demo notice" }).waitFor();
  }
  assert.deepEqual(await context.cookies(), []);
  assert.deepEqual(forbiddenRequests, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ event: "pages_demo.verify.completed", outcome: "success", checks: ["static-deep-links", "prefilled-example-details", "create-demo-account", "example-member", "example-officer", "event-filter", "rsvp-preview", "leaderboard-filter", "mobile", "no-api-writes", "no-auth-cookies"] }));
} finally {
  await browser?.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
