import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const baseUrl = process.env.MEMBER_BASE_URL ?? "http://127.0.0.1:3100";
const officerBaseUrl = process.env.OFFICER_BASE_URL ?? "http://officers.ph.localhost:3100";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    for (const route of ["/dashboard", "/leaderboards", "/settings"]) localStorage.setItem(`pytorch-ph:tour:${route}:v1`, "seen");
  });
  const page = await context.newPage();
  for (const route of ["/dashboard", "/leaderboards", "/settings", "/trust", "/membership?demo=pending"]) {
    await page.goto(`${baseUrl}${route}`);
    await page.locator("main").waitFor();
    const results = await new AxeBuilder({ page }).include("main").analyze();
    assert.deepEqual(results.violations.filter((item) => ["critical","serious"].includes(item.impact)).map((item) => item.id), [], route);
  }
  const settings = await page.evaluate(async () => (await fetch("/api/member/leaderboard-identity")).json());
  const anonymous = await page.evaluate(async (input) => {
    const response = await fetch("/api/member/leaderboard-identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  }, { username: settings.username, mode: "anonymous", realNameConsent: false });
  assert.equal(anonymous.status, 200);
  const ladder = await page.evaluate(async () => (await fetch("/api/member/leaderboard")).json());
  assert.equal(ladder.view, "both");
  const current = ladder.entries.find((entry) => entry.isCurrentUser);
  assert.match(current.displayLabel, /^Member #[A-F0-9]{5}$/);
  assert.deepEqual(Object.keys(current).sort(), ["displayLabel","division","isCurrentUser","pendingPoints","points","rank","streak","tier","verifiedPoints","verifiedSkills"].sort());
  await page.goto(`${baseUrl}/leaderboards`);
  await page.locator("[data-current-user=true]").waitFor();
  const report = await page.evaluate(async () => {
    const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "suggestion", description: "E2E feedback loop check", route: "/leaderboards", uiState: { title: document.title, viewport: `${innerWidth}x${innerHeight}`, online: navigator.onLine, componentMarkers: ["leaderboards-table"] } }) });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(report.status, 201);
  const officerPage = await context.newPage();
  await officerPage.goto(`${officerBaseUrl}/trust`);
  const officerReports = await officerPage.evaluate(async () => (await fetch("/api/feedback")).json());
  assert.ok(officerReports.some((item) => item.id === report.body.id));
  await officerPage.close();
  await page.evaluate(async (input) => fetch("/api/member/leaderboard-identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), { username: settings.username, mode: "nickname", realNameConsent: false });
  await context.close();
  console.log("Member command center accessibility, privacy projection, and identity revocation passed.");
} finally {
  await browser.close();
}
