import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Runs the production renderer against isolated published data; never the live API.
const FILTER_MARKUP = `
  <div role="group" data-event-filters hidden>
    <button type="button" aria-pressed="true" data-event-series="">All programs</button>
  </div>
  <div data-site-content="events"></div>
  <div class="past" data-hide-when-empty hidden><ul data-site-content="events-past"></ul></div>`;

async function rendererPage(t, state) {
  const source = await readFile(new URL("../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/renderer.js") { response.setHeader("Content-Type", "application/javascript"); response.end(source); }
    else if (request.url === "/defaults") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ leadership: [], chapters: [], articles: [], events: [] })); }
    else if (request.url === "/content") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ revision: state.revision, document: { leadership: [], chapters: [], articles: [], events: state.events }, officialPytorchNews: [] })); }
    else { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><body>${FILTER_MARKUP}<script src="/renderer.js" data-api="/content" data-defaults="/defaults"></script></body>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ timezoneId: "Asia/Manila" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2099-06-15T04:00:00Z"));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), state.revision);
  return { page, errors };
}

async function refresh(page, revision) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), revision);
}

const titles = page => page.locator('[data-site-content="events"] h3').allTextContents();

test("a selected series is cleared when the filter hides, so no published event stays excluded", async t => {
  const state = { revision: 1, events: [
    { id: "a", title: "Series A session", series: "Series A", startsAt: "2099-07-01", dateStatus: "confirmed" },
    { id: "b", title: "Series B session", series: "Series B", startsAt: "2099-07-02", dateStatus: "confirmed" },
    { id: "loose", title: "Ungrouped session", startsAt: "2099-07-03", dateStatus: "confirmed" },
  ] };
  const { page, errors } = await rendererPage(t, state);
  assert.equal(await page.locator("[data-event-filters]").isVisible(), true);
  // Buttons come from the published series (the "PyTorch " prefix is dropped), ordered by next session.
  assert.deepEqual(await page.locator("[data-event-filters] button").allTextContents(), ["All programs", "Series A", "Series B"]);
  await page.getByRole("button", { name: "Series A", exact: true }).click();
  assert.deepEqual(await titles(page), ["Series A session"]);

  // Series B is withdrawn: one series remains, so the filter hides and must stop filtering.
  state.events = state.events.filter(row => row.id !== "b");
  state.revision = 2;
  await refresh(page, 2);
  assert.equal(await page.locator("[data-event-filters]").isVisible(), false);
  assert.equal(await page.locator('[data-event-series=""]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(await titles(page), ["Series A session", "Ungrouped session"]);
  assert.deepEqual(errors, []);
});

test("past sessions list recent exact dates and timestamps, never months or old sessions", async t => {
  const state = { revision: 1, events: [
    { id: "upcoming", title: "Upcoming session", startsAt: "2099-07-01", dateStatus: "confirmed" },
    { id: "day", title: "Date-only session", startsAt: "2099-06-01", scheduleLabel: "June 1, 2099", dateStatus: "confirmed" },
    { id: "stamp", title: "Timestamp session", startsAt: "2099-06-10T08:00:00Z", dateStatus: "confirmed" },
    { id: "month", title: "Month-only session", startsAt: "2099-05", dateStatus: "confirmed" },
    { id: "tentative", title: "Tentative past session", startsAt: "2099-06-05", dateStatus: "tentative" },
    { id: "old", title: "Old session", startsAt: "2098-12-01", dateStatus: "confirmed" },
  ] };
  const { page, errors } = await rendererPage(t, state);
  assert.deepEqual(await titles(page), ["Upcoming session"]);
  const past = await page.locator('[data-site-content="events-past"] .ph-past-title').allTextContents();
  assert.deepEqual(past, ["Timestamp session", "Date-only session"]);
  assert.equal(await page.locator(".past").isVisible(), true);

  state.events = state.events.filter(row => row.id === "upcoming");
  state.revision = 2;
  await refresh(page, 2);
  assert.equal(await page.locator(".past").isVisible(), false);
  assert.deepEqual(errors, []);
});

test("officers can publish any series name and visitors can filter by it", async t => {
  const state = { revision: 1, events: [
    { id: "fund", title: "Fundamentals session", series: "PyTorch Fundamentals", startsAt: "2099-07-01", dateStatus: "confirmed" },
    { id: "custom", title: "Reading group session", series: "Paper Reading Circle", startsAt: "2099-07-02", dateStatus: "confirmed" },
  ] };
  const { page, errors } = await rendererPage(t, state);
  assert.deepEqual(await page.locator("[data-event-filters] button").allTextContents(), ["All programs", "Fundamentals", "Paper Reading Circle"]);
  await page.getByRole("button", { name: "Paper Reading Circle", exact: true }).click();
  assert.deepEqual(await titles(page), ["Reading group session"]);
  assert.equal(await page.getByRole("button", { name: "Paper Reading Circle", exact: true }).getAttribute("aria-pressed"), "true");

  // An unchanged refresh keeps the selection and the focused button.
  await page.getByRole("button", { name: "Paper Reading Circle", exact: true }).focus();
  state.revision = 2;
  await refresh(page, 2);
  assert.deepEqual(await titles(page), ["Reading group session"]);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Paper Reading Circle");
  assert.deepEqual(errors, []);
});

test("changing the series list keeps the focused button and selection, and a withdrawn selection falls back to All", async t => {
  const state = { revision: 1, events: [
    { id: "a", title: "Series A session", series: "Series A", startsAt: "2099-07-10", dateStatus: "confirmed" },
    { id: "b", title: "Series B session", series: "Series B", startsAt: "2099-07-11", dateStatus: "confirmed" },
    { id: "c", title: "Series C session", series: "Series C", startsAt: "2099-07-12", dateStatus: "confirmed" },
  ] };
  const { page, errors } = await rendererPage(t, state);
  const pressed = () => page.locator('[data-event-filters] [aria-pressed="true"]').allTextContents();
  await page.getByRole("button", { name: "Series B", exact: true }).click();
  await page.getByRole("button", { name: "Series B", exact: true }).focus();

  // A new series with an earlier session is published: buttons reorder, focus and selection stay on B.
  state.events.push({ id: "d", title: "Series D session", series: "Series D", startsAt: "2099-07-01", dateStatus: "confirmed" });
  state.revision = 2;
  await refresh(page, 2);
  assert.deepEqual(await page.locator("[data-event-filters] button").allTextContents(), ["All programs", "Series D", "Series A", "Series B", "Series C"]);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Series B");
  assert.deepEqual(await pressed(), ["Series B"]);
  assert.deepEqual(await titles(page), ["Series B session"]);

  // Series B is withdrawn while three series remain: All programs is selected and focused, every event shows.
  state.events = state.events.filter(row => row.id !== "b");
  state.revision = 3;
  await refresh(page, 3);
  assert.deepEqual(await pressed(), ["All programs"]);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "All programs");
  assert.deepEqual(await titles(page), ["Series D session", "Series A session", "Series C session"]);
  assert.deepEqual(errors, []);
});

const totals = page => page.evaluate(() => ["data-campus-total-universities", "data-campus-total-universities-label", "data-campus-total-people", "data-campus-total-people-label", 'data-island-total="Luzon"']
  .map(attribute => document.querySelector(`[${attribute}]`).textContent));

test("a university listed in the page gives way to the same university published by officers", async t => {
  const source = await readFile(new URL("../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const state = { revision: 1, chapters: [] };
  const markup = `
    <span data-chapter-count="Luzon"></span><span data-chapter-count="Visayas"></span>
    <p><b data-campus-total-universities>0</b> <i data-campus-total-universities-label></i> <b data-campus-total-people>0</b> <i data-campus-total-people-label></i> <span data-island-total="Luzon"></span></p>
    <div data-site-content="chapters-Luzon"></div>
    <ul><li data-static-chapter="Example State University" data-aliases="ESU|Example State" data-island="Luzon">Example State University</li>
        <li data-static-chapter="Second Example College–North Campus" data-aliases="" data-island="Luzon">Second Example College</li>
        <li data-static-chapter="St. Mary's Example Institute" data-aliases="" data-island="Luzon">St. Mary's Example Institute</li>
        <li class="ph-lead-pending" data-static-chapter="Example Co-Op College" data-aliases="" data-island="Luzon">Example Co-Op College</li></ul>
    <div data-site-content="chapters-Visayas"></div>`;
  const server = createServer((request, response) => {
    if (request.url === "/renderer.js") { response.setHeader("Content-Type", "application/javascript; charset=utf-8"); response.end(source); }
    else if (request.url === "/defaults") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ leadership: [], chapters: [], articles: [], events: [] })); }
    else if (request.url === "/content") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ revision: state.revision, document: { leadership: [], chapters: state.chapters, articles: [], events: [] }, officialPytorchNews: [] })); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><meta charset="utf-8"><body>${markup}<script src="/renderer.js" data-api="/content" data-defaults="/defaults"></script></body>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.documentElement.dataset.siteContentRevision === "1");
  // Nothing published: both listed universities show, are counted, and no empty message appears beside them.
  assert.equal(await page.locator("[data-static-chapter]:visible").count(), 4);
  assert.equal(await page.locator('[data-chapter-count="Luzon"]').textContent(), "· 4");
  assert.equal(await page.locator('[data-site-content="chapters-Luzon"]').textContent(), "");
  assert.match(await page.locator('[data-site-content="chapters-Visayas"]').textContent(), /No participating chapters/);
  // Every listed university counts; a listed university without a named lead adds no person.
  assert.deepEqual(await totals(page), ["4", "universities", "3", "people", "4"]);

  state.chapters = [{ id: "c1", university: "example state university", chapter: "Published chapter", island: "Luzon", status: "active", leadName: "A published lead" }];
  state.revision = 2;
  await refresh(page, 2);
  assert.deepEqual(await page.locator("[data-static-chapter]:visible").allTextContents(), ["Second Example College", "St. Mary's Example Institute", "Example Co-Op College"]);
  assert.match(await page.locator('[data-site-content="chapters-Luzon"]').textContent(), /Published chapter/);
  assert.equal(await page.locator('[data-chapter-count="Luzon"]').textContent(), "· 4");
  // The total counts the university once and the published lead in place of the listed one.
  assert.deepEqual(await totals(page), ["4", "universities", "3", "people", "4"]);
  // A published chapter renders as the same person-first card: the lead, their role, then the
  // university, all under the island heading (h4, never h3).
  const card = page.locator('[data-site-content="chapters-Luzon"] article.ph-lead');
  assert.equal(await card.locator("h4").textContent(), "A published lead");
  assert.equal(await card.locator(".ph-lead-role").textContent(), "Campus Labs Lead");
  assert.equal(await card.locator(".ph-lead-school").textContent(), "example state university");
  assert.equal(await card.locator(".ph-lead-badge").textContent(), "AL");
  // Name suffixes do not become initials.
  state.chapters = [{ id: "c1", university: "example state university", chapter: "Published chapter", island: "Luzon", status: "active", leadName: "Juan Santos Jr." }];
  state.revision = 21;
  await refresh(page, 21);
  assert.equal(await page.locator('[data-site-content="chapters-Luzon"] .ph-lead-badge').textContent(), "JS");
  assert.equal(await page.locator('[data-site-content="chapters-Luzon"] h3').count(), 0);

  // Officers may use an alias, different dashes, or drop punctuation inside a word ("St Marys", "Coop");
  // a withdrawn chapter brings the listed entry back.
  state.chapters = [
    { id: "c1", university: "ESU", chapter: "Published chapter", island: "Luzon", status: "active" },
    { id: "c2", university: "Second Example College - North Campus", chapter: "Other chapter", island: "Luzon", status: "active" },
    { id: "c3", university: "St Marys Example Institute", chapter: "Third chapter", island: "Luzon", status: "active" },
    { id: "c4", university: "Example Coop College", chapter: "Fourth chapter", island: "Luzon", status: "active" },
  ];
  state.revision = 3;
  await refresh(page, 3);
  assert.equal(await page.locator("[data-static-chapter]:visible").count(), 0);
  // A chapter without a named lead shows the university and says the lead is not announced.
  assert.match(await page.locator('[data-site-content="chapters-Luzon"] article.ph-lead-pending').first().textContent(), /Lead not announced yet/);
  assert.equal(await page.locator('[data-chapter-count="Luzon"]').textContent(), "· 4");
  // Four universities, but no named lead among the published chapters: nobody is counted as a person.
  assert.deepEqual(await totals(page), ["4", "universities", "0", "people", "4"]);
  state.chapters = [];
  state.revision = 4;
  await refresh(page, 4);
  assert.equal(await page.locator("[data-static-chapter]:visible").count(), 4);
  assert.equal(await page.locator('[data-site-content="chapters-Luzon"]').textContent(), "");
});

test("cards mirror the page: two leads at one university count once, and aliased publications count once", async t => {
  const source = await readFile(new URL("../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const state = { revision: 1, chapters: [] };
  // Same shape as _includes/ph/campus_islands.html + campus_chapter_list.html.
  const card = (lead, university, aliases) => `<article class="ph-lead" data-static-chapter="${university}" data-aliases="${aliases}" data-island="Luzon"><span class="ph-lead-badge" aria-hidden="true">X</span><div class="ph-lead-body"><h4 class="ph-lead-name">${lead}</h4><p class="ph-lead-school">${university}</p></div></article>`;
  const markup = `<div class="ph-island"><h3><span>Luzon</span> <span data-island-count="Luzon"></span></h3><span data-chapter-count="Luzon"></span>
    <div class="ph-lead-grid"><div class="ph-lead-set" data-site-content="chapters-Luzon"></div>
    <div class="ph-lead-set">${card("First Lead", "Alpha University", "AU|Alpha U")}${card("Second Lead", "Alpha University", "AU|Alpha U")}${card("Third Lead", "Beta College", "")}</div></div></div>`;
  const server = createServer((request, response) => {
    if (request.url === "/renderer.js") { response.setHeader("Content-Type", "application/javascript; charset=utf-8"); response.end(source); }
    else if (request.url === "/defaults") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ leadership: [], chapters: [], articles: [], events: [] })); }
    else if (request.url === "/content") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ revision: state.revision, document: { leadership: [], chapters: state.chapters, articles: [], events: [] }, officialPytorchNews: [] })); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><meta charset="utf-8"><body>${markup}<script src="/renderer.js" data-api="/content" data-defaults="/defaults"></script></body>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.documentElement.dataset.siteContentRevision === "1");
  const islandCount = () => page.locator('[data-island-count="Luzon"]').textContent();
  assert.equal(await page.locator("article.ph-lead:visible").count(), 3);
  assert.equal(await islandCount(), "2 universities");
  assert.equal(await page.locator('[data-chapter-count="Luzon"]').textContent(), "· 2");

  // Officers publish Alpha University twice (canonical name and an alias): both listed cards for it
  // hide, the published cards show, and Alpha still counts once.
  state.chapters = [
    { id: "p1", university: "Alpha University", chapter: "Alpha chapter", island: "Luzon", status: "active", leadName: "Published One" },
    { id: "p2", university: "Alpha U", chapter: "Alpha chapter", island: "Luzon", status: "active", leadName: "Published Two" },
  ];
  state.revision = 2;
  await refresh(page, 2);
  assert.deepEqual(await page.locator("[data-static-chapter]:visible h4").allTextContents(), ["Third Lead"]);
  assert.deepEqual(await page.locator('[data-site-content="chapters-Luzon"] h4').allTextContents(), ["Published One", "Published Two"]);
  assert.equal(await islandCount(), "2 universities");

  // Withdrawn again: the listed cards come back.
  state.chapters = [];
  state.revision = 3;
  await refresh(page, 3);
  assert.equal(await page.locator("article.ph-lead:visible").count(), 3);
  assert.equal(await islandCount(), "2 universities");
});
