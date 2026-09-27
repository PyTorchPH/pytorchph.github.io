import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.OFFICER_BASE_URL ?? process.env.WEB_BASE_URL ?? "http://officers.ph.localhost:3100";
const routes = [
  ["/dashboard", "Your command center"],
  ["/career/evidence", "What this page does"],
  ["/career/resumes", "What this page does"],
  ["/jobs/analytics", "Evidence-backed market view"],
  ["/jobs/automation", "What this page does"],
  ["/jobs/opportunities", "What this page does"],
  ["/connections", "What this page does"],
  ["/events", "Chapter events"],
  ["/leaderboards", "Public-safe rankings"],
  ["/settings", "System settings"]
];

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/login`);
  const developerAccess = page.getByRole("button", { name: "Enter local developer workspace" });
  if (await developerAccess.count()) {
    await developerAccess.click();
    await page.waitForURL("**/dashboard");
  } else {
    await page.goto(`${baseUrl}/dashboard`);
  }
  await page.evaluate(() => localStorage.clear());

  for (const [pathname, title] of routes) {
    await page.goto(`${baseUrl}${pathname}`);
    assert.equal(new URL(page.url()).origin, baseUrl, `${pathname} must stay on the SPA origin`);
    const tourDialog = page.getByRole("alertdialog");
    await tourDialog.waitFor({ state: "visible", timeout: 8_000 });
    await tourDialog.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.getByRole("button", { name: "Skip tour" }).click();
    await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  }

  await page.goto(`${baseUrl}/dashboard`);
  await page.waitForTimeout(800);
  assert.equal(await page.getByRole("alertdialog").count(), 0, "seen tour must not auto-open again");
  await page.getByRole("link", { name: "Job Analytics" }).click();
  await page.waitForURL("**/jobs/analytics");
  assert.equal(new URL(page.url()).origin, baseUrl, "sidebar navigation must remain on the SPA origin");
  await page.goto(`${baseUrl}/dashboard`);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Help / Tour" }).click();
  await page.getByRole("alertdialog").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);

  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${baseUrl}/login`);
  const mobileAccess = mobilePage.getByRole("button", { name: "Enter local developer workspace" });
  if (await mobileAccess.count()) {
    await mobileAccess.click();
    await mobilePage.waitForURL("**/dashboard");
  } else {
    await mobilePage.goto(`${baseUrl}/dashboard`);
  }
  await mobilePage.evaluate(() => localStorage.clear());
  await mobilePage.reload();
  await mobilePage.getByRole("alertdialog").waitFor({ state: "visible", timeout: 8_000 });
  const dimensions = await mobilePage.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    `tour caused horizontal overflow: ${dimensions.scrollWidth} > ${dimensions.clientWidth}`
  );
  await mobilePage.getByRole("button", { name: "Skip tour" }).click();
  await mobilePage.getByRole("button", { name: "Replay page tour" }).click();
  await mobilePage.getByRole("alertdialog").waitFor({ state: "visible" });
  await mobileContext.close();

  console.log(`Product tour smoke test passed for ${routes.length} routes and mobile replay.`);
} finally {
  await browser.close();
}
