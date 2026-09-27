import assert from "node:assert/strict";
import { chromium } from "playwright";

const memberBase = process.env.MEMBER_BASE_URL ?? "http://127.0.0.1:3100";
const officerBase = process.env.OFFICER_BASE_URL ?? "http://officers.ph.localhost:3100";
const browser = await chromium.launch({ headless: true });

try {
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await memberContext.addInitScript(() => {
    for (const route of ["/dashboard", "/jobs/opportunities", "/events", "/leaderboards"]) {
      localStorage.setItem(`pytorch-ph:tour:${route}:v1`, "seen");
    }
  });
  const page = await memberContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${memberBase}/jobs/opportunities`);
  await page.getByText("Local member demo · Synthetic data · External actions disabled").waitFor();
  const beforeOpportunity = await page.evaluate(async () => (await fetch("/api/product/opportunities", { cache: "no-store" })).json());
  const beforeStage = beforeOpportunity.opportunities.find((item) => item.id === "opp-3").stage;
  const opportunity = page.getByRole("heading", { name: "Data Automation Associate" }).locator("..");
  await opportunity.getByRole("button", { name: /Move to/i }).click();
  await page.waitForLoadState("networkidle");
  await page.getByText("Data Automation Associate").waitFor();
  const stored = await page.evaluate(async () => (await fetch("/api/product/opportunities", { cache: "no-store" })).json());
  assert.notEqual(stored.opportunities.find((item) => item.id === "opp-3").stage, beforeStage);

  const officerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await officerContext.addInitScript(() => localStorage.setItem("pytorch-ph:tour:/jobs/automation:v1", "seen"));
  const officerPage = await officerContext.newPage();
  officerPage.on("pageerror", (error) => errors.push(error.message));
  await officerPage.goto(`${officerBase}/jobs/automation`);
  const gateLabels = officerPage.getByText(/Explicit human approval required/);
  await gateLabels.first().waitFor();
  const before = await gateLabels.count();
  await officerPage.getByRole("button", { name: "Approve this demo gate" }).first().click();
  await officerPage.waitForLoadState("networkidle");
  const after = await officerPage.getByText(/Explicit human approval required/).count();
  assert.equal(after, before - 1);

  await page.goto(`${memberBase}/events`);
  const join = page.getByRole("button", { name: "Join synthetic event" }).first();
  await join.click();
  await page.getByRole("button", { name: "Leave synthetic event" }).first().waitFor();

  await page.goto(`${memberBase}/leaderboards`);
  await page.getByText("Alex Rivera").waitFor();
  assert.deepEqual(errors, []);
  await officerContext.close();
  await memberContext.close();
  console.log("Local opportunity, approval, event, and cohort workflows passed.");
} finally {
  await browser.close();
}
