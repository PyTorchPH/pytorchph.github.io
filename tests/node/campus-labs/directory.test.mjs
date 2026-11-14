// Drives the built Campus Labs page (frontend/public-site/_site) in Chromium with the site-content API
// stubbed: the directory lists everyone alphabetically (on screen and for screen readers alike),
// filters by island group and by name or university, says how many it shows, and keeps
// officer-published chapters in the same order and filter as they are published and withdrawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
const people = readFileSync(resolve(site, "../_data/campus_labs.yml"), "utf8").match(/^\s+- name: .+$/gm).length;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

// state.chapters and state.revision are what the stubbed API publishes; change them, then refresh().
async function campusPage(t, state, path = "/campus-labs/") {
  assert.ok(existsSync(resolve(site, "campus-labs/index.html")), "Build the public Pages site first");
  const server = createServer((request, response) => {
    let file = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    if (file.endsWith("/")) file += "index.html";
    file = resolve(site, `.${file}`);
    if (!file.startsWith(site) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === "https://api.pytorch.ph/public/site-content") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 3, revision: state.revision, document: { leadership: [], chapters: state.chapters, articles: [], events: [] }, officialPytorchNews: [] }) });
    }
    return url.startsWith(origin) ? route.continue() : route.abort();
  });
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), state.revision);
  const directory = page.locator("[data-campus-directory]");
  // Visible cards in reading order on screen (top to bottom, then left to right) and in the DOM.
  const shown = () => directory.evaluate(root => [...root.querySelectorAll(".ph-lead")]
    .filter(card => card.getClientRects().length)
    .map(card => ({ card, box: card.getBoundingClientRect() }))
    .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
    .map(({ card }) => card.querySelector(".ph-lead-name").textContent.trim()));
  const inDom = () => directory.evaluate(root => [...root.querySelectorAll(".ph-lead")]
    .filter(card => card.getClientRects().length)
    .map(card => card.querySelector(".ph-lead-name").textContent.trim()));
  const count = () => page.locator("[data-campus-count]").textContent();
  const refresh = async () => {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), state.revision);
  };
  return { page, errors, shown, inDom, count, refresh };
}

const alphabetical = names => [...names].sort((a, b) => a.localeCompare(b, "en-PH", { sensitivity: "base" }));
const published = (id, university, island, leadName) => ({ id, university, island, leadName, status: "active" });

test("the directory lists everyone alphabetically and filters by island group and by name or university", async t => {
  const { page, errors, shown, inDom, count } = await campusPage(t, { revision: 1, chapters: [] });
  const everyone = await shown();
  assert.equal(everyone.length, people);
  assert.deepEqual(everyone, alphabetical(everyone));
  assert.deepEqual(await inDom(), everyone, "screen readers meet the cards in the order they show");
  assert.equal(await page.locator("[data-campus-directory] h3.ph-lead-name").count(), people, "card names are h3 under the section's h2");
  assert.equal(await count(), `Showing ${people} people`);

  await page.getByRole("button", { name: /^Visayas/ }).click();
  assert.deepEqual(await shown(), ["Jhon Patrick Watimar", "Julian Gen Carticiano", "Yurii Onein Yankin"]);
  assert.equal(await count(), "Showing 3 people");
  assert.equal(await page.getByRole("button", { name: /^Visayas/ }).getAttribute("aria-pressed"), "true");

  // Search covers universities too, and ignores case and accents ("Mapúa").
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByLabel("Search by name or university").fill("mapua");
  assert.deepEqual(await shown(), ["Justin Andre De Leon"]);
  assert.equal(await count(), "Showing 1 person");

  await page.getByLabel("Search by name or university").fill("no such person");
  assert.deepEqual(await shown(), []);
  assert.equal(await count(), "Showing 0 people");
  assert.equal(await page.getByText("No one matches these filters.").isVisible(), true);

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  assert.equal((await shown()).length, people);
  assert.equal(await page.getByLabel("Search by name or university").inputValue(), "");
  assert.deepEqual(errors, []);
});

test("officer-published chapters join in order and inside the active filter, and leave when withdrawn", async t => {
  const state = { revision: 1, chapters: [
    // Replaces the poster entry for the same university.
    published("c1", "Cebu Technological University", "Visayas", "Zed Published"),
    published("c2", "Example State College", "Mindanao", "Aaron Published"),
  ] };
  const { page, errors, shown, inDom, count, refresh } = await campusPage(t, state);
  const everyone = await shown();
  assert.equal(everyone.length, people + 1);
  assert.deepEqual(everyone, alphabetical(everyone));
  assert.equal(everyone[0], "Aaron Published");
  assert.deepEqual(await inDom(), everyone);
  assert.ok(!everyone.includes("Julian Gen Carticiano"), "the published chapter replaces the poster entry");
  assert.equal(await page.locator("[data-campus-directory] h3.ph-lead-name", { hasText: "Aaron Published" }).count(), 1, "published cards use the same heading level");

  await page.getByRole("button", { name: /^Visayas/ }).click();
  assert.deepEqual(await shown(), ["Jhon Patrick Watimar", "Yurii Onein Yankin", "Zed Published"]);
  assert.equal(await count(), "Showing 3 people");

  // A refresh withdraws Cebu (the poster entry returns) and publishes a new Visayas chapter.
  state.chapters = [published("c2", "Example State College", "Mindanao", "Aaron Published"), published("c3", "Example Visayas College", "Visayas", "Bea Published")];
  state.revision = 2;
  await refresh();
  assert.deepEqual(await shown(), ["Bea Published", "Jhon Patrick Watimar", "Julian Gen Carticiano", "Yurii Onein Yankin"]);
  assert.deepEqual(await inDom(), await shown());
  assert.equal(await count(), "Showing 4 people");

  // Withdrawing every chapter leaves only the poster entries.
  state.chapters = [];
  state.revision = 3;
  await refresh();
  await page.getByRole("button", { name: /^All/ }).click();
  const after = await shown();
  assert.equal(after.length, people);
  assert.ok(!after.some(name => name.endsWith("Published")), "withdrawn chapters leave the directory");
  assert.deepEqual(errors, []);
});

test("a refresh that hides the focused control returns focus to the search", async t => {
  const state = { revision: 1, chapters: [] };
  const { page, errors, refresh } = await campusPage(t, state);
  // Matches nothing until the refresh publishes it.
  await page.getByLabel("Search by name or university").fill("xylo");
  const clear = page.locator("[data-campus-none] button");
  assert.equal(await clear.isVisible(), true);
  await clear.focus();
  state.chapters = [published("c1", "Example State College", "Mindanao", "Xylo Published")];
  state.revision = 2;
  await refresh();
  assert.equal(await page.locator("[data-campus-none]").isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "campus-search");
  assert.deepEqual(errors, []);
});

test("links to an island group filter the list, on load, when the link changes, and back", async t => {
  const { page, errors, shown } = await campusPage(t, { revision: 1, chapters: [] });
  const pressed = island => page.waitForFunction(value => document.querySelector(`button[data-island-filter="${value}"]`)?.getAttribute("aria-pressed") === "true", island);
  await page.evaluate(() => { location.hash = "#campus-visayas"; });
  await pressed("Visayas");
  assert.equal((await shown()).length, 3);
  // An in-page link that is not an island group leaves the filter alone.
  await page.evaluate(() => { location.hash = "#start"; });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole("button", { name: /^Visayas/ }).getAttribute("aria-pressed"), "true");
  // Back to the page without a fragment shows everyone again, as a reload of that address would.
  await page.goBack();
  await page.goBack();
  await pressed("");
  assert.equal((await shown()).length, people);
  await page.goForward();
  await pressed("Visayas");
  assert.deepEqual(errors, []);
});

test("an island group link filters the list when the page opens", async t => {
  const { page, errors, shown } = await campusPage(t, { revision: 1, chapters: [] }, "/campus-labs/#campus-mindanao");
  assert.equal((await shown()).length, 4);
  assert.equal(await page.getByRole("button", { name: /^Mindanao/ }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
});
