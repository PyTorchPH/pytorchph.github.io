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

  await page.getByLabel("Region").selectOption("Visayas");
  assert.deepEqual(await shown(), ["Jhon Patrick Watimar", "Julian Gen Carticiano", "Yurii Onein Yankin"]);
  assert.equal(await count(), "Showing 3 people");
  assert.equal(await page.getByLabel("Region").inputValue(), "Visayas");

  // Search covers universities too, and ignores case and accents ("Mapúa").
  await page.getByLabel("Region").selectOption("");
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

test("cards have 8px corners that clip the photo, and the search and selectors have 6px", async t => {
  const { page, errors } = await campusPage(t, { revision: 1, chapters: [] });
  const style = (selector, property) => page.locator(selector).first().evaluate((node, name) => getComputedStyle(node)[name], property);
  assert.equal(await style("[data-campus-directory] .ph-lead", "borderTopLeftRadius"), "8px");
  assert.equal(await style("[data-campus-directory] .ph-lead", "overflow"), "hidden");
  for (const selector of ["[data-campus-search]", "[data-campus-region]", "[data-campus-batch]"]) assert.equal(await style(selector, "borderTopLeftRadius"), "6px", selector);
  assert.equal(await style(".ph-hero-actions .btn", "borderTopLeftRadius"), "8px");
  assert.deepEqual(errors, []);
});

test("two selectors, region and batch, filter together", async t => {
  const { page, errors, shown, count } = await campusPage(t, { revision: 1, chapters: [] });
  const region = page.getByLabel("Region");
  const batch = page.getByLabel("Batch");
  // Selectors, not rows of buttons; each option says how many people it holds.
  assert.equal(await page.locator("[data-campus-filters] button[data-island-filter]").count(), 0);
  assert.deepEqual(await region.locator("option").allTextContents(), ["All regions", "Luzon (19)", "Visayas (3)", "Mindanao (4)"]);
  assert.deepEqual(await batch.locator("option").allTextContents(), ["All batches", "Batch 1 (10)", "Batch 2 (16)"]);
  await batch.selectOption("1");
  assert.equal(await count(), "Showing 10 people");
  // Together: Batch 1 in the Visayas.
  await region.selectOption("Visayas");
  const both = await shown();
  assert.ok(both.length > 0 && both.length < 3, `${both.length} people`);
  assert.equal(await count(), `Showing ${both.length} ${both.length === 1 ? "person" : "people"}`);
  await batch.selectOption("2");
  assert.equal((await shown()).length, 3 - both.length);
  // "Clear filters" resets both.
  await page.locator("[data-campus-filters] [data-campus-clear]").click();
  assert.equal(await region.inputValue(), "");
  assert.equal(await batch.inputValue(), "");
  assert.equal(await count(), `Showing ${people} people`);
  // Clicking an island on the map still sets the region.
  await page.locator(".ph-archipelago-label[data-island-filter='Mindanao']").click();
  assert.equal(await region.inputValue(), "Mindanao");
  assert.equal(await count(), "Showing 4 people");
  assert.deepEqual(errors, []);
});

test("hovering a profile sweeps PyTorch orange across it from the left, and out to the right on leaving", async t => {
  const { page, errors } = await campusPage(t, { revision: 1, chapters: [] });
  const card = page.locator("[data-campus-directory] .ph-lead").first();
  const state = () => card.evaluate(node => {
    const bar = getComputedStyle(node.querySelector(".ph-lead-badge"), "::after");
    const name = getComputedStyle(node.querySelector(".ph-lead-name"));
    return { bar: bar.transform, origin: bar.transformOrigin.split(" ")[0], fill: name.backgroundSize.split(",")[0].trim(), from: name.backgroundPosition.split(",")[0].trim().split(" ")[0] };
  });
  // At rest: no line, the name in its usual color, both parked on the right (where they leave to).
  const rest = await state();
  assert.equal(rest.bar, "matrix(0, 0, 0, 1, 0, 0)");
  assert.equal(rest.fill, "0% 100%");
  await card.hover();
  await page.waitForTimeout(700);
  const hovered = await state();
  assert.equal(hovered.bar, "matrix(1, 0, 0, 1, 0, 0)");
  assert.equal(hovered.origin, "0px", "the line grows from the left");
  assert.equal(hovered.fill, "100% 100%");
  assert.equal(hovered.from, "0%", "the name fills from the left");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(700);
  assert.deepEqual(await state(), rest);
  assert.notEqual(rest.origin, "0px", "the line leaves toward the right");
  // Still readable in both states: the name is never left transparent without its fill.
  assert.equal(await card.locator(".ph-lead-name").evaluate(node => getComputedStyle(node).backgroundClip), "text, text");
  // People who prefer reduced motion get the color without the sweep.
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await card.evaluate(node => getComputedStyle(node.querySelector(".ph-lead-name")).transitionDuration), "0s");
  assert.deepEqual(errors, []);
});

test("the directory's header says each number once", async t => {
  const { page, errors } = await campusPage(t, { revision: 1, chapters: [] });
  const section = page.locator("#people");
  // No totals line and no extra heading over the controls: the island buttons and the one status line carry the numbers.
  assert.equal(await section.locator("[data-campus-total]").count(), 0);
  assert.equal(await section.getByRole("heading", { name: "Filter the list" }).count(), 0);
  assert.equal(await section.getByRole("group", { name: "Filter the list" }).count(), 1);
  const header = await section.evaluate(node => [...node.querySelectorAll("h2, .ph-lede, [data-campus-filters], [data-campus-count]")].map(part => part.textContent).join(" ").replace(/\s+/g, " "));
  for (const number of ["19", "26"]) assert.equal(header.split(number).length - 1, 1, `${number} appears once in: ${header}`);
  // "Clear filters" shows only while a filter is on.
  const clear = section.locator("[data-campus-filters] [data-campus-clear]");
  assert.equal(await clear.isVisible(), false);
  await page.getByLabel("Region").selectOption("Visayas");
  assert.equal(await clear.isVisible(), true);
  await clear.click();
  assert.equal(await clear.isVisible(), false);
  await page.getByLabel("Search by name or university").fill("mapua");
  assert.equal(await clear.isVisible(), true);
  assert.deepEqual(errors, []);
});

test("a card says only what is its own: no repeated \"Campus Labs\" title, the batch as one quiet line", async t => {
  const { page, errors } = await campusPage(t, { revision: 1, chapters: [] });
  const cards = page.locator("[data-campus-directory] .ph-lead");
  // Only a title a poster gives is shown: one person is the Campus Labs Lead.
  assert.deepEqual(await cards.locator(".ph-lead-role").allTextContents(), ["Campus Labs Lead"]);
  const batches = await cards.locator(".ph-lead-batch").allTextContents();
  assert.equal(batches.length, people);
  assert.ok(batches.every(text => /^Batch [12]$/.test(text.trim())));
  // Plain text, not a boxed tag.
  assert.equal(await cards.locator(".ph-lead-batch").first().evaluate(node => getComputedStyle(node).borderTopWidth), "0px");
  // The words "Campus Labs" appear in a card only for that one title.
  const mentions = await cards.evaluateAll(nodes => nodes.filter(node => /Campus Labs/.test(node.textContent)).length);
  assert.equal(mentions, 1);
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

  await page.getByLabel("Region").selectOption("Visayas");
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
  await page.getByLabel("Region").selectOption("");
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
  const pressed = island => page.waitForFunction(value => document.querySelector("[data-campus-region]")?.value === value, island);
  await page.evaluate(() => { location.hash = "#campus-visayas"; });
  await pressed("Visayas");
  assert.equal((await shown()).length, 3);
  // An in-page link that is not an island group leaves the filter alone.
  await page.evaluate(() => { location.hash = "#start"; });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByLabel("Region").inputValue(), "Visayas");
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
  assert.equal(await page.getByLabel("Region").inputValue(), "Mindanao");
  assert.deepEqual(errors, []);
});
