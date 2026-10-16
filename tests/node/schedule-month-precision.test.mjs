import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

test("month-only schedules remain visible through the month and display no invented day", async () => {
  const source = await readFile(new URL("../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const document = { leadership: [], chapters: [], articles: [], events: [{ id: "example-month", title: "Example monthly session", startsAt: "2099-02", scheduleLabel: "February 2099", dateStatus: "tentative", modules: "Example module" }, {id:"example-day",title:"Example exact-day session",startsAt:"2099-02-28",scheduleLabel:"February 28, 2099",dateStatus:"confirmed",modules:"Example module" }] };
  const server = createServer((request, response) => {
    if (request.url === "/renderer.js") { response.setHeader("Content-Type", "application/javascript"); response.end(source); }
    else if (request.url === "/defaults") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({leadership:[],chapters:[],articles:[],events:[]})); }
    else if (request.url === "/content") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ revision: 1, document, officialPytorchNews: [] })); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<div data-site-content="events"></div><script src="/renderer.js" data-api="/content" data-defaults="/defaults"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({timezoneId:"America/Los_Angeles"});
    await page.clock.setFixedTime(new Date("2099-02-15T12:00:00Z"));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("heading", { name: "Example monthly session" }).waitFor();
    const content = await page.locator('[data-site-content="events"]').textContent();
    assert.match(content, /Tentative.*February 2099/);
    assert.doesNotMatch(content, /February 1,/);
    await page.clock.setFixedTime(new Date("2099-02-28T18:00:00Z"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByRole("heading", { name:"Example exact-day session" }).waitFor();
    await page.clock.setFixedTime(new Date("2099-03-02T12:00:00Z"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("No upcoming events match this learning series.", { exact: true }).waitFor();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
