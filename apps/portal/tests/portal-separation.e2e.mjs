import assert from "node:assert/strict";
import { chromium } from "playwright";

const memberBase = process.env.MEMBER_BASE_URL ?? "http://127.0.0.1:3100";
const officerBase = process.env.OFFICER_BASE_URL ?? "http://officers.ph.localhost:3100";
const browser = await chromium.launch({ headless: true });

function forbiddenKeys(value, path = "root") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const current = `${path}.${key}`;
    const own = /(cookie|token|password|credential|storage|raw|stack|filesystem|mediaPath)/i.test(key) ? [current] : [];
    return [...own, ...forbiddenKeys(child, current)];
  });
}

try {
  const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await member.newPage();
  await memberPage.goto(`${memberBase}/dashboard`);
  await memberPage.getByTestId("member-dashboard").waitFor();
  const memberTour = memberPage.getByRole("alertdialog");
  await memberTour.waitFor({ timeout: 8_000 });
  await memberTour.getByRole("heading", { name: "Your personal workspace", exact: true }).waitFor();
  await memberTour.getByRole("button", { name: "Skip tour" }).click();
  assert.equal(await memberPage.getByRole("link", { name: "Job Automation", exact: true }).count(), 0);
  assert.equal(await memberPage.getByRole("link", { name: "Connections", exact: true }).count(), 0);
  assert.equal(await memberPage.getByTestId("developer-diagnostics").count(), 0);
  const memberPayload = await memberPage.evaluate(async () => {
    const response = await fetch("/api/product/dashboard", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(memberPayload.status, 200);
  assert.equal("diagnostics" in memberPayload.body, false);
  assert.equal("analytics" in memberPayload.body, false);
  assert.equal("operations" in memberPayload.body, false);
  assert.deepEqual(forbiddenKeys(memberPayload.body), []);
  const blockedProduct = await memberPage.evaluate(async () => (await fetch("/api/product/job-operations")).status);
  assert.equal(blockedProduct, 403);
  await memberPage.goto(`${memberBase}/jobs/automation`);
  assert.equal(new URL(memberPage.url()).pathname, "/dashboard");
  await memberPage.goto(`${memberBase}/events`);
  assert.equal(await memberPage.getByRole("button", { name: "Officer", exact: true }).count(), 0);
  await member.close();

  const officer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await officer.addInitScript(() => localStorage.setItem("pytorch-ph:tour:/dashboard:v3", "seen"));
  const officerPage = await officer.newPage();
  await officerPage.goto(`${officerBase}/dashboard`);
  await officerPage.getByText("Officer command", { exact: true }).waitFor();
  await officerPage.getByTestId("developer-diagnostics").waitFor();
  await officerPage.getByRole("link", { name: "Job Automation", exact: true }).waitFor();
  await officerPage.getByRole("link", { name: "Connections", exact: true }).waitFor();
  const officerPayload = await officerPage.evaluate(async () => {
    const response = await fetch("/api/product/dashboard", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(officerPayload.status, 200);
  assert.equal(officerPayload.body.diagnostics.schemaVersion, "1");
  assert.equal(officerPayload.body.diagnostics.request.audience, "officer");
  assert.equal(officerPayload.body.diagnostics.authorization.isOfficer, true);
  assert.deepEqual(forbiddenKeys(officerPayload.body.diagnostics), []);
  await officer.close();
  console.log("Member/officer portal separation and sanitized diagnostics passed.");
} finally {
  await browser.close();
}
