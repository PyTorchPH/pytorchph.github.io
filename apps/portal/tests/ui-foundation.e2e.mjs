import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const baseUrl = process.env.MEMBER_BASE_URL ?? process.env.WEB_BASE_URL ?? "http://127.0.0.1:3100";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("pytorch-ph:tour:/career/resumes:v1", "seen"));
  const page = await context.newPage();
  await page.goto(`${baseUrl}/career/resumes`);
  await page.getByRole("button", { name: /Classic/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  assert.deepEqual(serious.map((item) => ({ id: item.id, nodes: item.nodes.length })), []);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await context.close();
  console.log("Radix dialog accessibility and keyboard smoke passed.");
} finally {
  await browser.close();
}
