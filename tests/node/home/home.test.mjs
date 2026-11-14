// Drives the built home page (frontend/public-site/_site) in Chromium with the site-content API
// stubbed, for the layout taken from PyTorch Korea (pytorch.kr): the header sits over the hero photo
// and darkens as the hero scrolls away, the hero ends in layered waves, and upcoming events come first,
// as on pytorch.kr, in two rows of three open columns: the published training courses with their modules,
// and the community event series from _data/community_events.yml with their next dates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp" };
// The browser clock is fixed (noon in Manila, November 20, 2026 unless a test says otherwise), so the
// dates in _data/community_events.yml and in these published sessions read the same on any day.
const NOW = "2026-11-20T04:00:00Z";
const LONG_WORD = "DistributedDataParallelFullyShardedDataParallelTensorParallelPipelineParallelContextParallelExpertParallel";
const events = [
  // Three training courses: one finished, one under way, one ahead.
  { id: "f1", title: "Example Fundamentals", series: "Example Fundamentals", startsAt: "2026-10-25", dateStatus: "confirmed", eventType: "training", modules: "Getting Started; The Workflow" },
  { id: "f2", title: "Example Fundamentals", series: "Example Fundamentals", startsAt: "2026-11-08", dateStatus: "confirmed", eventType: "training", modules: "Data; Networks" },
  { id: "t1", title: "Example Techniques", series: "Example Techniques", startsAt: "2026-11", scheduleLabel: "November 2026", dateStatus: "tentative", eventType: "training", modules: "Module 1: Tensors; Module 2: Training loops" },
  { id: "t2", title: "Example Techniques", series: "Example Techniques", startsAt: "2026-12", scheduleLabel: "December 2026", dateStatus: "tentative", eventType: "training", isDemo: true, modules: "Module 3: Text; Module 4: Pipelines; Module 4: Pipelines" },
  { id: "a1", title: "Example Advanced", series: "Example Advanced", startsAt: "2027-01", scheduleLabel: "January 2027", dateStatus: "tentative", eventType: "training", modules: `Module 1: Architectures; Module 2: ${LONG_WORD}`, registrationUrl: "https://example.org/register" },
  // A published series the data file does not name, with a poster.
  { id: "pr", title: "Paper Reading Circle", series: "Paper Reading Circle", startsAt: "2027-04-03", dateStatus: "confirmed", eventType: "paper_reading", description: "We read one paper together.", photoUrl: "https://example.org/poster.jpg" },
];

async function homePage(t, width, { javaScript = true, height = 900, published = events, now = NOW, chapters = [] } = {}) {
  const state = { revision: 1, events: published, chapters };
  assert.ok(existsSync(resolve(site, "index.html")), "Build the public Pages site first");
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
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: "Asia/Manila", reducedMotion: "reduce", javaScriptEnabled: javaScript });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === "https://api.pytorch.ph/public/site-content") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 3, revision: state.revision, document: { leadership: [], chapters: state.chapters, articles: [], events: state.events }, officialPytorchNews: [] }) });
    }
    // The site's own files, and Google Fonts, so layouts are measured in the real typefaces.
    return url.startsWith(origin) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url) ? route.continue() : route.abort();
  });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${origin}/`);
  if (javaScript) await page.waitForFunction(() => document.documentElement.dataset.siteContentRevision === "1");
  if (javaScript) await page.evaluate(() => document.fonts.ready);
  const refresh = async () => {
    state.revision += 1;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), state.revision);
  };
  return { page, errors, state, refresh };
}

const innerWidthOf = width => width;
const headerAlpha = page => page.evaluate(() => {
  const [, , , alpha = "1"] = getComputedStyle(document.querySelector(".ph-header")).backgroundColor.match(/[\d.]+/g);
  return Number(alpha);
});

const textOf = locator => locator.evaluate(node => node.textContent.replace(/\s+/g, " ").trim());
const occurrences = (text, part) => text.split(part).length - 1;
const tiles = page => page.locator('[data-site-content="program-events"] > .ph-tile');
const courses = page => page.locator('[data-site-content="program-training"] > .ph-course');

// Community events are three equal dark tiles (after the Linux Foundation's event pages: the name, then
// the date large); training is a slim list with details one click away. Both parts get the same weight.
for (const [width, height] of [[1280, 800], [1440, 900], [1024, 768]]) {
  test(`at ${width} × ${height} the community events' names show without scrolling`, async t => {
    const { page, errors } = await homePage(t, width, { height });
    const boxes = await tiles(page).evaluateAll(nodes => nodes.slice(0, 3).map(node => ({ top: node.getBoundingClientRect().top, title: node.querySelector("h4").getBoundingClientRect().bottom })));
    assert.ok(boxes.every(box => Math.abs(box.top - boxes[0].top) < 1), "side by side");
    for (const box of boxes) assert.ok(box.title <= height - 40, `a name ends at ${Math.round(box.title)}px of ${height}`);
    assert.deepEqual(errors, []);
  });
}

test("community events: three equal dark tiles, each with its kind, name, one sentence, and its date large", async t => {
  const { page, errors } = await homePage(t, 1440);
  assert.equal(await textOf(page.locator(".ph-program-label").nth(0)), "Community events");
  assert.equal(await page.locator(".ph-feature").count(), 0, "no single event is featured");
  assert.deepEqual(await tiles(page).locator("h4").allTextContents(), ["Tensor Talks: Initialized", "ML & Coffee", "Torch Trials", "Paper Reading Circle"]);
  assert.deepEqual(await tiles(page).locator(".ph-tile-kind").allTextContents(), ["Talks", "Meetup", "Hackathon", "Paper reading"]);
  // Equal: the first three share one row, one width, one height, one dark background.
  const boxes = await tiles(page).evaluateAll(nodes => nodes.slice(0, 3).map(node => { const box = node.getBoundingClientRect(); return { top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height), background: getComputedStyle(node).backgroundColor }; }));
  assert.equal(new Set(boxes.map(box => JSON.stringify(box))).size, 1, JSON.stringify(boxes));
  assert.equal(boxes[0].background, "rgb(38, 38, 38)");
  // The date, large, said once; only the dates the organizers give.
  assert.equal(await textOf(tiles(page).nth(0).locator(".ph-tile-date")), "Saturday January 16, 2027");
  assert.equal(await textOf(tiles(page).nth(1).locator(".ph-tile-date")), "Saturday, Tentative February 20, 2027");
  assert.equal(await textOf(tiles(page).nth(2).locator(".ph-tile-date")), "Saturday, Tentative March 20, 2027");
  assert.equal(occurrences(await textOf(tiles(page).nth(0)), "2027"), 1);
  // The large dates sit on one line across the tiles.
  const dateTops = await tiles(page).evaluateAll(nodes => nodes.slice(0, 3).map(node => Math.round(node.querySelector(".ph-tile-day").getBoundingClientRect().top)));
  assert.equal(new Set(dateTops).size, 1);
  assert.ok(await tiles(page).nth(0).locator(".ph-tile-date").evaluate(node => parseFloat(getComputedStyle(node.querySelector(".ph-tile-day")).fontSize) >= 22));
  assert.match(await textOf(tiles(page).nth(0).locator(".ph-tile-blurb")), /^Technical talks on how modern AI systems are built/);
  assert.equal(await textOf(tiles(page).nth(0).locator(".ph-event-note")), "Call for proposals open until December 6.");
  // A published series the data file does not name gets a tile too, with its poster.
  assert.equal(await textOf(tiles(page).nth(3).locator(".ph-tile-date")), "Saturday April 3, 2027");
  assert.equal(await tiles(page).nth(3).locator("img").getAttribute("alt"), "Poster: Paper Reading Circle");
  assert.equal(await tiles(page).nth(0).locator("img").count(), 0);
  assert.deepEqual(errors, []);
});

test("training: a light card per upcoming course, its modules one click away, finished courses behind a small toggle", async t => {
  const { page, errors } = await homePage(t, 1440);
  assert.equal(await textOf(page.locator(".ph-program-label").nth(1)), "Training");
  assert.deepEqual(await courses(page).locator("h4").allTextContents(), ["Example Techniques", "Example Advanced"]);
  assert.equal(await textOf(courses(page).nth(0).locator(".ph-course-when")), "November and December 2026 (tentative)");
  assert.equal(await textOf(courses(page).nth(1).locator(".ph-course-when")), "January 2027 (tentative)");
  // Cards too, like the community events, but light: side by side, same width, a light background.
  const cards = await courses(page).evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { top: Math.round(box.top), width: Math.round(box.width), background: getComputedStyle(node).backgroundColor }; }));
  assert.equal(new Set(cards.map(card => JSON.stringify(card))).size, 1, JSON.stringify(cards));
  assert.equal(cards[0].background, "rgb(243, 244, 247)");
  // Sample data says so on the line itself.
  assert.equal(await courses(page).nth(0).locator("summary").getByText("Demo/Test").isVisible(), true);
  // Modules as published, each once, hidden until the course is opened.
  const modules = courses(page).nth(0).locator("ol.ph-event-modules li");
  assert.equal(await modules.first().isVisible(), false);
  await courses(page).nth(0).locator("summary").click();
  assert.deepEqual(await modules.allTextContents(), ["Tensors", "Training loops", "Text", "Pipelines"]);
  // Opened, the course splits into its sessions: each with its own date and its own modules, side by
  // side across the card, and the summary's dates step aside so no date shows twice.
  const sessions = courses(page).nth(0).locator(".ph-session");
  assert.deepEqual(await sessions.locator(".ph-session-when").allTextContents(), ["November 2026 (tentative)", "December 2026 (tentative)"]);
  assert.deepEqual(await sessions.nth(0).locator("li").allTextContents(), ["Tensors", "Training loops"]);
  assert.deepEqual(await sessions.nth(1).locator("li").allTextContents(), ["Text", "Pipelines"]);
  const spread = await sessions.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()).map(box => ({ top: Math.round(box.top), left: Math.round(box.left) })));
  assert.ok(spread[0].top === spread[1].top && spread[1].left > spread[0].left + 200, "sessions sit side by side");
  assert.equal(await courses(page).nth(0).locator(".ph-course-when").isVisible(), false);
  assert.equal(await courses(page).nth(1).locator(".ph-course-when").isVisible(), true, "a closed card keeps its dates");
  await courses(page).nth(1).locator("summary").click();
  assert.equal(await courses(page).nth(1).getByRole("link", { name: /Learn more/ }).getAttribute("href"), "https://example.org/register");
  // The finished course is not listed outright.
  const previous = page.locator("details.ph-previous");
  assert.equal(await previous.getAttribute("open"), null);
  assert.equal(await textOf(previous.locator(":scope > summary")), "Previous courses (1)");
  assert.equal(await previous.getByText("Example Fundamentals").isVisible(), false);
  await previous.locator(":scope > summary").click();
  assert.equal(await previous.getByText("Example Fundamentals").isVisible(), true);
  assert.equal(await textOf(previous.locator(".ph-course-when")), "October 25 and November 8, 2026");
  assert.deepEqual(errors, []);
});

test("nothing repeats and nothing is a placeholder", async t => {
  const { page, errors } = await homePage(t, 1440);
  const section = (await page.locator("#events .ph-program").evaluateAll(nodes => nodes.map(node => node.textContent).join(" "))).replace(/\s+/g, " ");
  for (const title of ["Example Fundamentals", "Example Techniques", "Example Advanced", "Tensor Talks", "ML & Coffee", "Torch Trials", "Paper Reading Circle"]) assert.equal(occurrences(section, title), 1, title);
  assert.doesNotMatch(section, /TBA|to be announced|Covers |Completed/i);
  assert.equal(await page.locator("#events [data-event-filters]").count(), 0);
  assert.deepEqual(errors, []);
});

test("the call for proposals line follows the calendar: opens, open until, then gone", async t => {
  const note = async now => {
    const { page } = await homePage(t, 1440, { now });
    const line = tiles(page).nth(0).locator(".ph-event-note");
    return await line.count() ? textOf(line) : null;
  };
  assert.equal(await note("2026-11-14T04:00:00Z"), "Call for proposals opens November 18.");
  assert.equal(await note("2026-11-20T04:00:00Z"), "Call for proposals open until December 6.");
  assert.equal(await note("2026-12-07T04:00:00Z"), null);
});

test("once an event has passed, its series moves on to the next one", async t => {
  const { page, errors } = await homePage(t, 1440, { now: "2027-01-20T04:00:00Z" });
  assert.equal(await tiles(page).nth(0).locator("h4").textContent(), "Tensor Talks #2");
  assert.equal(await textOf(tiles(page).nth(0).locator(".ph-tile-date")), "Tentative March 2027");
  assert.deepEqual(errors, []);
});

test("a session published in the portal replaces the planned one for its series", async t => {
  const published = [{ id: "tt", title: "Tensor Talks: Initialized", series: "Tensor Talks", startsAt: "2027-01-23", dateStatus: "confirmed", eventType: "talk", venue: "Makati", registrationUrl: "https://example.org/talks" }];
  const { page, errors } = await homePage(t, 1440, { published });
  const tile = tiles(page).nth(0);
  assert.equal(await textOf(tile.locator(".ph-tile-date")), "Saturday January 23, 2027");
  assert.equal(await textOf(tile.locator(".ph-tile-kind")), "Talks · Makati");
  assert.equal(await tile.getByRole("link", { name: /Learn more/ }).getAttribute("href"), "https://example.org/talks");
  assert.equal(await tiles(page).count(), 3);
  // With no training sessions published, that part and its label stay out of the way.
  assert.equal(await page.locator(".ph-program").nth(1).isVisible(), false);
  assert.deepEqual(errors, []);
});

test("a published session that has passed does not bring the planned date back", async t => {
  const published = [{ id: "tt", title: "Tensor Talks: Initialized", series: "Tensor Talks", startsAt: "2027-01-09", dateStatus: "confirmed", eventType: "talk", isDemo: true }];
  const { page, errors } = await homePage(t, 1440, { published, now: "2027-01-10T04:00:00Z" });
  assert.equal(await tiles(page).nth(0).locator("h4").textContent(), "Tensor Talks #2");
  assert.deepEqual(errors, []);
});

test("an unchanged refresh keeps an opened course open and keyboard focus where it was", async t => {
  const { page, errors, refresh } = await homePage(t, 1440);
  await courses(page).nth(0).locator("summary").focus();
  await page.keyboard.press("Enter");
  await refresh();
  assert.equal(await courses(page).nth(0).evaluate(node => node.open), true);
  assert.equal(await page.evaluate(() => document.activeElement?.closest(".ph-course") !== null), true);
  assert.deepEqual(errors, []);
});

// No small text (pytorch.org is the reference): everything a visitor reads on the home page is at least
// 16px on a desktop and 15px on a phone, and paragraphs are at least 18px on a desktop.
for (const [width, floor] of [[1440, 16], [390, 15]]) {
  test(`at ${width}px no text on the home page is smaller than ${floor}px`, async t => {
    const { page, errors } = await homePage(t, width);
    await page.evaluate(() => document.querySelectorAll("details").forEach(node => { node.open = true; }));
    const small = await page.evaluate(floor => {
      const found = new Map();
      const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
      const footer = document.createTreeWalker(document.querySelector("footer"), NodeFilter.SHOW_TEXT);
      for (const walk of [walker, footer]) {
        while (walk.nextNode()) {
          const node = walk.currentNode, parent = node.parentElement;
          if (!node.textContent.trim() || !parent.getClientRects().length || parent.closest(".ph-visually-hidden, script, noscript")) continue;
          const size = parseFloat(getComputedStyle(parent).fontSize);
          if (size < floor) found.set(`${parent.className || parent.tagName} ${size}px`, node.textContent.trim().slice(0, 30));
        }
      }
      return [...found].map(([where, text]) => `${where}: ${text}`);
    }, floor);
    assert.deepEqual(small, []);
    if (width === 1440) {
      const paragraphs = await page.locator("#events .ph-tile-blurb, .ph-stack .ph-flow-projects p:not(.ph-flow-part), .ph-hero .lead").evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      assert.ok(Math.min(...paragraphs) >= 18, `paragraphs from ${Math.min(...paragraphs)}px`);
    }
    assert.deepEqual(errors, []);
  });
}

// Corners follow pytorch.org (measured there: 8px on buttons and cards, 6px on form fields, none on
// full-width bands): nothing that is a button or a card is left square, and bands stay square.
test("buttons and cards have 8px corners, and full-width bands stay square", async t => {
  const { page, errors } = await homePage(t, 1440);
  const radius = selector => page.locator(selector).first().evaluate(node => getComputedStyle(node).borderTopLeftRadius);
  for (const selector of [".ph-hero-actions .btn", ".ph-tile", ".ph-course", ".ph-nationwide .btn", '[data-site-content="pytorch-news"] .ph-card', "#get-involved .ph-card"]) assert.equal(await radius(selector), "8px", selector);
  for (const selector of [".ph-hero", "#events", ".ph-stack", "footer.site-footer", ".header-holder"]) assert.equal(await radius(selector), "0px", selector);
  // Hovering a button changes its colors; no line is drawn under its rounded corners.
  const button = page.locator(".ph-hero-actions .btn").first();
  assert.equal(await button.evaluate(node => getComputedStyle(node, "::after").display), "none");
  await button.hover();
  await page.waitForTimeout(400);
  assert.deepEqual(await button.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.color]; }), ["rgb(190, 44, 16)", "rgb(255, 255, 255)"]);
  await page.mouse.move(5, 500);
  // A card clips what is inside it to its corners.
  assert.equal(await page.locator(".ph-tile").first().evaluate(node => getComputedStyle(node).overflow), "hidden");
  assert.deepEqual(errors, []);
});

// The map on the home page counts the Campus Labs universities in each island group, as the Campus Labs
// page's map does: from _data/campus_labs.yml, plus chapters officers publish (a university once).
test("the home page map shows how many Campus Labs universities each island group has", async t => {
  const data = readFileSync(resolve(site, "../_data/campus_labs.yml"), "utf8");
  const listed = island => (data.match(new RegExp(`^\\s+island:\\s*${island}\\b`, "gm")) ?? []).length;
  const labels = page => page.locator(".ph-nationwide .ph-archipelago-label").evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()));
  const { page, errors } = await homePage(t, 1440);
  assert.deepEqual(await labels(page), [`Luzon · ${listed("Luzon")}`, `Visayas · ${listed("Visayas")}`, `Mindanao · ${listed("Mindanao")}`]);
  assert.ok(listed("Luzon") > 0);
  assert.deepEqual(errors, []);
  // A published chapter at a new university adds one; one at a listed university (by an alias) does not.
  const published = await homePage(t, 1440, { chapters: [
    { id: "c1", university: "Example State College", island: "Visayas", leadName: "A Lead", status: "active" },
    { id: "c2", university: "BulSU", island: "Luzon", leadName: "B Lead", status: "active" },
  ] });
  assert.deepEqual(await labels(published.page), [`Luzon · ${listed("Luzon")}`, `Visayas · ${listed("Visayas") + 1}`, `Mindanao · ${listed("Mindanao")}`]);
  // Without JavaScript the counts from the data file are already in the page.
  const plain = await homePage(t, 1440, { javaScript: false });
  assert.deepEqual(await labels(plain.page), [`Luzon · ${listed("Luzon")}`, `Visayas · ${listed("Visayas")}`, `Mindanao · ${listed("Mindanao")}`]);
});

// The phone menu is more than a list: it wipes in from the left behind an orange edge and out to the
// right, its links arrive one after another, the archipelago sits in its empty corner, and it ends with
// the tagline, the way to join, and the contact links.
test("the phone menu sweeps in and out, and ends with the tagline and a way to join", async t => {
  const { page, errors } = await homePage(t, 390, { height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const menu = page.locator("#ph-mobile-menu");
  const open = page.locator("[data-behavior='open-mobile-menu']");
  await open.click();
  assert.equal(await menu.isVisible(), true);
  assert.equal(await menu.evaluate(node => getComputedStyle(node).animationName), "ph-menu-in");
  assert.match(await menu.evaluate(node => getComputedStyle(node, "::after").backgroundImage), /ph-network\.svg/);
  // The links arrive in turn: each a little after the one before.
  const delays = await menu.locator(".main-menu > ul > li").evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).animationDelay)));
  assert.ok(delays.length >= 5 && delays.every((delay, index) => index === 0 || delay > delays[index - 1]), JSON.stringify(delays));
  // The current section carries the orange line.
  assert.equal(await menu.locator("li.active > .ph-mobile-submenu").evaluate(node => getComputedStyle(node).borderLeftColor), "rgb(238, 76, 44)");
  // It ends with the tagline, the way to join, and the contacts, inside the screen.
  const foot = menu.locator(".ph-menu-foot");
  assert.equal((await foot.locator(".ph-menu-tagline").textContent()).replace(/\s+/g, " ").trim(), "Sindihan ang sulo.");
  assert.equal(await foot.locator(".ph-menu-tagline").getAttribute("lang"), "fil");
  assert.equal(await foot.getByRole("link", { name: "Join the community" }).getAttribute("href"), "/portal/register/");
  assert.deepEqual(await foot.locator(".ph-menu-contacts a").allTextContents(), ["Facebook", "LinkedIn", "Email"]);
  await page.waitForTimeout(700);
  assert.ok((await foot.boundingBox()).y + (await foot.boundingBox()).height <= 844 + 1, "the foot fits on the first screen of the menu");
  // Closing sweeps out, then the menu is gone and focus is back on the button that opened it.
  await menu.locator("[data-behavior='close-mobile-menu']").click();
  assert.equal(await menu.evaluate(node => node.classList.contains("closing")), true);
  await page.waitForFunction(() => !document.querySelector("#ph-mobile-menu").classList.contains("open"));
  assert.equal(await menu.isVisible(), false);
  assert.equal(await open.evaluate(node => node === document.activeElement), true);
  // People who prefer reduced motion get the menu without the sweep.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open.click();
  assert.equal(await menu.evaluate(node => getComputedStyle(node).animationName), "none");
  await page.keyboard.press("Escape");
  assert.equal(await menu.isVisible(), false);
  assert.deepEqual(errors, []);
});

// The footer notice is short, as on pytorch.kr: two lines (independence, and the trademark statement
// word for word from the PyTorch brand book). The photo and code credits the licenses require stay in
// the footer, behind a closed "Credits" toggle.
test("the footer has no loose rows: contacts are a column of links, and Credits sits in the notice line", async t => {
  const { page, errors } = await homePage(t, 1440);
  assert.equal(await page.locator("footer .ph-footer-contacts").count(), 0);
  const columns = page.locator("footer .footer-links-col");
  assert.deepEqual(await columns.locator(".list-title").allTextContents(), ["Community", "Learn", "About", "Connect"]);
  assert.deepEqual((await columns.nth(3).locator("li:not(.list-title)").allTextContents()).map(text => text.trim()), ["Facebook", "LinkedIn", "Email"]);
  assert.match(await columns.nth(3).getByRole("link", { name: "Email" }).getAttribute("href"), /^mailto:/);
  const tops = await columns.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, "four columns in one row");
  // "Credits" ends the trademark line instead of sitting on a line of its own.
  const same = await page.evaluate(() => {
    const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top);
    return Math.abs(top("footer .ph-footer-credits > summary") - top('footer a[href*="trademark-usage"]')) < 6;
  });
  assert.equal(same, true);
  assert.deepEqual(errors, []);
});

test("the footer notice is two short lines, with the credits one click away", async t => {
  const { page, errors } = await homePage(t, 1440);
  const notice = page.locator("footer .trademark-disclaimer");
  // Each line's own text (the second also holds the closed "Credits" list).
  const lines = await notice.locator(".ph-footer-notice").evaluateAll(nodes => nodes.map(node => [...node.childNodes].filter(child => child.nodeName !== "DETAILS").map(child => child.textContent).join("")));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /PyTorch, the PyTorch logo and any related marks are trademarks of The Linux Foundation\./);
  for (const line of lines) assert.ok(line.trim().length <= 200, `"${line.trim()}" is ${line.trim().length} characters`);
  const credits = notice.locator("details.ph-footer-credits");
  assert.equal(await credits.getAttribute("open"), null);
  assert.equal(await credits.locator("[data-photo-credit]").first().isVisible(), false);
  await credits.locator("summary").click();
  assert.equal(await credits.locator('[data-photo-credit="rizal_monument"]').isVisible(), true);
  assert.equal(await credits.getByText(/adapted from the open-source/).isVisible(), true);
  assert.deepEqual(errors, []);
});

test("the closing trio points to this community, not to general PyTorch pages", async t => {
  const { page, errors } = await homePage(t, 1440);
  const trio = page.locator(".docs-tutorials-resources");
  assert.deepEqual(await trio.locator("h2").allTextContents(), ["PyTorchPH on GitHub", "Campus Labs", "Community page"]);
  assert.equal(await trio.getByRole("link", { name: "Meet the Campus Labs" }).getAttribute("href"), "/campus-labs/");
  assert.match(await trio.getByRole("link", { name: "Go to Facebook" }).getAttribute("href"), /^https:\/\/(www\.)?facebook\.com\//);
  assert.deepEqual(errors, []);
});

// The phone layout stays as it is (the site owner likes it): the hero is not compacted there beyond
// the greeting line the owner removed.
test("on a phone the hero keeps its height", async t => {
  const { page } = await homePage(t, 390, { height: 844 });
  const hero = await page.locator(".ph-hero").boundingBox();
  assert.ok(Math.abs(hero.height - 509) <= 6, `phone hero is ${Math.round(hero.height)}px tall (509 with readable text sizes and no greeting line)`);
});

test("events come right after the hero, before the Foundation projects", async t => {
  const { page, errors } = await homePage(t, 1440);
  const order = await page.locator("main > section").evaluateAll(sections => sections.map(section => section.id || section.className.split(" ").find(name => name.startsWith("ph-hero"))));
  assert.deepEqual(order.slice(0, 3), ["ph-hero", "events", "stack"]);
  assert.deepEqual(errors, []);
});

test("the header sits over the hero photo and turns solid once the hero scrolls away", async t => {
  const { page, errors } = await homePage(t, 1440);
  assert.equal((await page.locator(".ph-hero").boundingBox()).y, 0, "the hero starts under the header");
  assert.ok(Math.abs(await headerAlpha(page) - 0.165) < 0.01, "a light tint over the photo at the top");
  // Once the page moves, the header is dark enough for white text over anything (0.68 or more), then
  // darkens gradually to solid: halfway through the hero it is partway.
  await page.evaluate(() => window.scrollTo(0, 20));
  await page.waitForFunction(() => !/0\.165\)/.test(getComputedStyle(document.querySelector(".ph-header")).backgroundColor));
  assert.ok(await headerAlpha(page) >= 0.68, "readable as soon as the page scrolls");
  await page.evaluate(() => window.scrollTo(0, (document.querySelector(".ph-hero").offsetHeight - document.querySelector(".ph-header").offsetHeight) / 2));
  await page.waitForTimeout(400);
  const halfway = await headerAlpha(page);
  assert.ok(halfway > 0.75 && halfway < 0.95, `halfway tint ${halfway}`);
  await page.evaluate(() => window.scrollTo(0, document.querySelector(".ph-hero").offsetHeight));
  await page.waitForFunction(() => !/rgba/.test(getComputedStyle(document.querySelector(".ph-header")).backgroundColor) || / 1\)$/.test(getComputedStyle(document.querySelector(".ph-header")).backgroundColor));
  assert.equal(await headerAlpha(page), 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => /0\.16/.test(getComputedStyle(document.querySelector(".ph-header")).backgroundColor));
  assert.deepEqual(errors, []);
});

test("without JavaScript the header stays solid, so the menu reads over any content", async t => {
  const { page } = await homePage(t, 1440, { javaScript: false });
  assert.equal(await headerAlpha(page), 1);
  await page.evaluate(() => window.scrollTo(0, 2000));
  assert.equal(await headerAlpha(page), 1);
});

// Menu text needs 4.5:1 (WCAG 2.2, 1.4.3) against whatever is behind the header: every hero photo, at
// the top and while scrolling. Each top-level link is checked in its own colors, as shown and on hover
// (the current page's link included), against the background measured under it with the text hidden.
test("the menu keeps 4.5:1 contrast on every photo, at the top and while scrolling", async t => {
  const { page } = await homePage(t, 1440);
  await page.evaluate(() => document.fonts.ready);
  const photos = await page.locator(".ph-hero-slide").evaluateAll(slides => slides.map(slide => slide.dataset.heroPhoto));
  assert.ok(photos.length >= 2);
  const linear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = ([r, g, b]) => 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
  const links = page.locator(".ph-header .main-menu > ul > li > a");
  const menu = [];
  for (let index = 0; index < await links.count(); index++) {
    const link = links.nth(index);
    const color = () => link.evaluate(node => getComputedStyle(node).color.match(/\d+/g).slice(0, 3).map(Number));
    const shown = await color();
    await link.hover();
    const hovered = await color();
    await page.mouse.move(5, 600);
    // The current page's dot (li.active::after) is a state marker: 3:1 for non-text (WCAG 2.2, 1.4.11).
    const marker = await link.evaluate(node => node.parentElement.classList.contains("active") ? getComputedStyle(node.parentElement, "::after").color.match(/\d+/g).slice(0, 3).map(Number) : null);
    menu.push({ name: (await link.textContent()).trim(), colors: [shown, hovered], marker, box: await link.boundingBox() });
  }
  await page.addStyleTag({ content: ".ph-header .main-menu a, .ph-header .ph-brand-name { color: transparent !important; } .ph-hero-slide, .ph-header, .ph-header a { transition: none !important; }" });
  const heroEnd = await page.evaluate(() => document.querySelector(".ph-hero").offsetHeight);
  // The top, the dark band leaving, the headline passing behind the menu, and the hero's end.
  const positions = [0, 60, 120, 175, 250, 330, Math.round(heroEnd / 2), heroEnd - 100];
  for (const photo of photos) {
    await page.evaluate(async key => {
      const slides = [...document.querySelectorAll(".ph-hero-slide")];
      const slide = slides.find(node => node.dataset.heroPhoto === key);
      await new Promise(done => { const image = new Image(); image.onload = image.onerror = done; image.src = slide.dataset.image; });
      slides.forEach(node => node.classList.toggle("is-active", node === slide));
      slide.style.backgroundImage = `url("${slide.dataset.image}")`;
      slide.style.opacity = "1";
    }, photo);
    for (const position of positions) {
      await page.evaluate(y => window.scrollTo(0, y), position);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      for (const item of menu) {
        const { data, info } = await sharp(await page.screenshot({ clip: item.box })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const backgrounds = [];
        for (let index = 0; index < data.length; index += info.channels) backgrounds.push(luminance([data[index], data[index + 1], data[index + 2]]));
        backgrounds.sort((a, b) => a - b);
        // The lightest and darkest background under the link, against each of its colors.
        const [darkest, lightest] = [backgrounds[Math.floor(backgrounds.length * 0.01)], backgrounds[Math.floor(backgrounds.length * 0.99)]];
        const worstAgainst = color => Math.min(...[darkest, lightest].map(background => (Math.max(luminance(color), background) + 0.05) / (Math.min(luminance(color), background) + 0.05)));
        for (const color of item.colors) {
          assert.ok(worstAgainst(color) >= 4.5, `${photo} at scrollY ${position}: "${item.name}" in rgb(${color}) at ${worstAgainst(color).toFixed(2)}:1`);
        }
        if (item.marker) assert.ok(worstAgainst(item.marker) >= 3, `${photo} at scrollY ${position}: the current-page dot in rgb(${item.marker}) at ${worstAgainst(item.marker).toFixed(2)}:1`);
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});

test("the hero ends in layered waves", async t => {
  const { page } = await homePage(t, 1440);
  const opacities = await page.locator(".ph-hero-wave path").evaluateAll(paths => paths.map(path => Number(path.getAttribute("fill-opacity") ?? "1")));
  assert.equal(opacities.length, 3);
  assert.equal(opacities.at(-1), 1, "the last layer is solid, matching the section below");
  assert.ok(opacities.slice(0, -1).every(value => value > 0 && value < 1), "the layers behind it are see-through");
  // The photo is lighter under the waves than behind the headline, so the layers read as frosted glass
  // over the picture, not as flat grey bands: the dark overlay eases off toward the bottom.
  const mask = await page.locator(".ph-hero-slides").evaluate(node => { const style = getComputedStyle(node, "::after"); return style.maskImage || style.webkitMaskImage; });
  assert.match(mask, /linear-gradient/);
  const clip = { x: 200, width: 1000, height: 6 };
  const hero = await page.locator(".ph-hero").boundingBox();
  const brightness = async y => { const { data } = await sharp(await page.screenshot({ clip: { ...clip, y } })).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return data.reduce((sum, value) => sum + value, 0) / data.length; };
  await page.addStyleTag({ content: ".ph-hero-wave, .ph-hero-content { visibility: hidden !important; }" });
  assert.ok(await brightness(hero.height - 30) > 1.5 * await brightness(hero.height - 300), "brighter near the bottom");
  assert.equal(Math.round((await page.locator(".ph-hero-wave").boundingBox()).height), 120, "as tall as pytorch.kr's on wide screens");
});








test("the headline is a short staggered Tagalog phrase, with its meaning for those who need it", async t => {
  const { page, errors } = await homePage(t, 1440);
  // Nothing sits above the headline: no greeting line.
  assert.equal(await page.locator(".ph-hero .ph-hero-kicker").count(), 0);
  assert.equal(await page.locator(".ph-hero h1").evaluate(node => node.previousElementSibling), null);
  const heading = page.getByRole("heading", { level: 1 });
  // Shown: "Sindihan ang sulo." over three lines, the middle one indented as on pytorch.kr.
  const lines = heading.locator(".ph-hero-line");
  assert.deepEqual((await lines.allTextContents()).map(text => text.trim()), ["Sindihan", "ang", "sulo."]);
  // Where each line's text starts (the indent is padding, inside the line's box).
  const starts = await lines.evaluateAll(nodes => nodes.map(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return Math.round(range.getBoundingClientRect().left);
  }));
  assert.ok(starts[1] > starts[0] && starts[2] === starts[0], "the middle line is indented");
  // The last word, the torch, is in PyTorch orange; the rest is white.
  assert.deepEqual(await lines.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color)), ["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(238, 76, 44)"]);
  // The lines take the heading's typeface and weight (a base rule sets Open Sans 400 on every
  // element, spans included): Montserrat, not thin.
  const fonts = await lines.evaluateAll(nodes => nodes.map(node => ({ family: getComputedStyle(node).fontFamily, weight: Number(getComputedStyle(node).fontWeight) })));
  for (const font of fonts) {
    assert.match(font.family, /^Montserrat/);
    assert.ok(font.weight >= 500, `weight ${font.weight}`);
  }
  // The Tagalog lines are marked Filipino, so screen readers pronounce them; the heading itself stays
  // English (the page's language), so its English tooltip and meaning are pronounced as English.
  assert.deepEqual(await lines.evaluateAll(nodes => nodes.map(node => node.lang)), ["fil", "fil", "fil"]);
  assert.equal(await heading.getAttribute("lang"), null);
  assert.equal(await heading.evaluate(node => node.closest("[lang]").lang), "en");
  assert.equal(await heading.getAttribute("title"), "Light the torch.");
  assert.equal((await heading.evaluate(node => node.textContent)).replace(/\s+/g, " ").trim(), "Sindihan ang sulo. (Light the torch.)");
  assert.equal(await heading.locator(".ph-visually-hidden").evaluate(node => getComputedStyle(node).position), "absolute", "the meaning is visually hidden");
  // The line under it names PyTorch® (its first prominent use on the home page) and is Filipino too.
  const lead = page.locator(".ph-hero .lead");
  // Two lines of medium length, not one long line.
  const leadLines = await lead.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node.firstChild); return [...range.getClientRects()].filter(rect => rect.width > 1); });
  assert.equal(leadLines.length, 2);
  assert.ok((await lead.boundingBox()).width <= 520, "medium line length");
  assert.equal(await lead.getAttribute("lang"), "fil");
  assert.match(await lead.textContent(), /^Isang malayang komunidad sa Pilipinas para sa pag-aaral at paggawa gamit ang PyTorch®\./);
  assert.deepEqual(errors, []);
});

for (const width of [320, 390]) {
  test(`at ${width}px the staggered headline fits`, async t => {
    const { page, errors } = await homePage(t, width);
    assert.equal(await page.locator(".ph-hero h1 .ph-hero-line").count(), 3, "the three lines are there to measure");
    // Each phrase stays on one line (a wrapped phrase breaks the stagger) and inside the screen.
    const lines = await page.locator(".ph-hero h1 .ph-hero-line").evaluateAll(nodes => nodes.map(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return { text: node.textContent.trim(), boxes: [...range.getClientRects()].filter(rect => rect.width > 1).length, right: range.getBoundingClientRect().right };
    }));
    for (const line of lines) {
      assert.equal(line.boxes, 1, `"${line.text}" wraps`);
      assert.ok(line.right <= innerWidthOf(width) - 8, `"${line.text}" runs off the screen`);
    }
    assert.deepEqual(errors, []);
  });
}

test("on a tablet a very long word in an event wraps instead of widening the page", async t => {
  const { page, errors } = await homePage(t, 768, { height: 1024 });
  // Open every course, so the hidden details count too.
  await page.evaluate(() => document.querySelectorAll("#events details").forEach(node => { node.open = true; }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test("on a phone nothing scrolls sideways and the header still starts over the photo", async t => {
  const { page, errors } = await homePage(t, 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal((await page.locator(".ph-hero").boundingBox()).y, 0);
  assert.equal(Math.round((await page.locator(".ph-hero-wave").boundingBox()).height), 64);
  assert.deepEqual(errors, []);
});
