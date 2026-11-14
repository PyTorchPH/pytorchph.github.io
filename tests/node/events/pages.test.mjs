// Drives the built event directory (frontend/public-site/_site/events/) in Chromium with the
// site-content API stubbed: the index at /events/, and one page for each community event series in
// _data/community_events.yml with the specifics the organizers have stated; Tensor Talks' page carries
// its call for proposals (the call itself is on Sessionize). The pages are laid out after the Linux Foundation's PyTorch event
// pages: a hero with the name on the left and the date and place in capitals on the right, a
// countdown, an introduction in ordinary text beside a colored box, a row of figures, and bands with
// centered headings. Nothing but what the organizers have stated may appear: no finances, no
// organizers' names, no unconfirmed venues, no placeholders.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp" };
// Noon in Manila on November 20, 2026: the call for proposals opened two days before.
const NOW = "2026-11-20T04:00:00Z";
const PAGES = ["tensor-talks", "ml-and-coffee", "torch-trials"];
const CFP = "/events/tensor-talks/"; // the call for proposals is part of the event's page
const ALL = PAGES.map(slug => `/events/${slug}/`);
const published = [
  { id: "t1", title: "Example Techniques", series: "Example Techniques", startsAt: "2026-12", scheduleLabel: "December 2026", dateStatus: "tentative", eventType: "training", modules: "Tensors; Training loops" },
  { id: "pr", title: "Paper Reading Circle", series: "Paper Reading Circle", startsAt: "2027-04-03", dateStatus: "confirmed", eventType: "paper_reading", description: "We read one paper together." },
];

async function open(t, path, width = 1440, { now = NOW, height = 900, javaScript = true, rewrite = null, motion = "reduce", flow = false } = {}) {
  assert.ok(existsSync(resolve(site, "index.html")), "Build the public Pages site first");
  const server = createServer((request, response) => {
    let file = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    if (file.endsWith("/")) file += "index.html";
    file = resolve(site, `.${file}`);
    if (!file.startsWith(site) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(rewrite && extname(file) === ".html" ? rewrite(readFileSync(file, "utf8")) : readFileSync(file));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: "Asia/Manila", reducedMotion: motion, javaScriptEnabled: javaScript });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === "https://api.pytorch.ph/public/site-content") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 3, revision: 1, document: { leadership: [], chapters: [], articles: [], events: published }, officialPytorchNews: [] }) });
    }
    return url.startsWith(origin) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url) ? route.continue() : route.abort();
  });
  // The clock stands still at `now`, or with `flow` runs on from it so timers can be advanced.
  if (flow) await page.clock.install({ time: new Date(now) });
  else await page.clock.setFixedTime(new Date(now));
  const response = await page.goto(`${origin}${path}`);
  assert.equal(response.status(), 200, path);
  if (javaScript) await page.waitForFunction(() => document.documentElement.dataset.siteContentRevision === "1");
  if (javaScript) await page.evaluate(() => document.fonts.ready);
  return { page, errors, origin };
}

const textOf = locator => locator.evaluate(node => node.textContent.replace(/\s+/g, " ").trim());
const textsOf = locator => locator.evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()));
const occurrences = (text, part) => text.split(part).length - 1;
const hero = page => page.locator(".ph-event-hero .ph-event-when > p").evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()));
const stats = page => page.locator(".ph-event-stats > li").evaluateAll(nodes => nodes.map(node => [node.querySelector("strong").textContent.trim(), node.querySelector("span").textContent.trim()]));
const countdown = page => page.locator(".ph-countdown li").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => `${node.querySelector("[data-unit]").textContent} ${node.querySelector("[data-unit]").dataset.unit}`));
// The page's own text: main without the closing row of the other events, which carry their own dates.
const ownText = page => page.locator("main").evaluate(node => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll(".ph-more-events, script, .ph-visually-hidden").forEach(part => part.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
});
const built = path => readFileSync(resolve(site, `.${path}`, "index.html"), "utf8");

test("the directory at /events/ lists the community events, each linked to its own page, and the training courses", async t => {
  const { page, errors } = await open(t, "/events/");
  assert.equal(await textOf(page.locator("h1")), "Events");
  const tiles = page.locator('[data-site-content="program-events"] > .ph-tile');
  assert.deepEqual(await tiles.locator("h4").allTextContents(), ["Tensor Talks: Initialized", "ML & Coffee", "Torch Trials", "Paper Reading Circle"]);
  assert.deepEqual(await tiles.locator("h4 a").evaluateAll(nodes => nodes.map(node => new URL(node.href).pathname)), PAGES.map(slug => `/events/${slug}/`));
  assert.deepEqual(await page.locator('[data-site-content="program-training"] > .ph-tile h4').allTextContents(), ["Example Techniques"]);
  // It is a page of its own now, not a redirect to the home page.
  assert.equal(new URL(page.url()).pathname, "/events/");
  assert.equal(await page.locator('meta[http-equiv="refresh"]').count(), 0);
  assert.deepEqual(errors, []);
});

test("the menu and the footer lead to the directory", async t => {
  const { page } = await open(t, "/");
  for (const scope of [".ph-header", "footer"]) {
    const links = await page.locator(`${scope} a`).evaluateAll(nodes => nodes.map(node => new URL(node.href).pathname));
    assert.ok(links.includes("/events/"), scope);
  }
});

test("Tensor Talks: the hero has the name and kind on the left, and the date, place and weekday on the right", async t => {
  const { page, errors } = await open(t, "/events/tensor-talks/");
  assert.equal(await textOf(page.locator("h1")), "Tensor Talks: Initialized");
  assert.equal(await textOf(page.locator(".ph-event-kind")), "Talks");
  assert.deepEqual(await hero(page), ["January 23, 2027", "Metro Manila", "Saturday, tentative"]);
  assert.equal(await page.locator(".ph-event-date time").getAttribute("datetime"), "2027-01-23");
  // Side by side on a wide screen, and the date in capitals, bold and widely spaced, as on the Linux Foundation's pages.
  const [name, when] = await page.locator(".ph-event-hero-layout > div").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  assert.ok(name.right <= when.left && Math.abs((name.top + name.bottom) / 2 - (when.top + when.bottom) / 2) < 40, "two columns, centered on each other");
  // The two halves meet at the middle of the page, as on their pages: the name is centered in its
  // half, and the date starts just right of the center, so they read as one block.
  const meet = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".ph-event-hero h1"));
    const title = range.getBoundingClientRect(), half = document.querySelector(".ph-event-name").getBoundingClientRect();
    return { off: Math.abs((title.left + title.right) / 2 - (half.left + half.right) / 2), gap: document.querySelector(".ph-event-date").getBoundingClientRect().left - title.right, start: document.querySelector(".ph-event-date").getBoundingClientRect().left - innerWidth / 2 };
  });
  assert.ok(meet.off < 2 && meet.gap < 200 && meet.start >= 0 && meet.start < 60, JSON.stringify(meet));
  const date = await page.locator(".ph-event-date").evaluate(node => { const style = getComputedStyle(node); return [style.textTransform, style.fontWeight, parseFloat(style.letterSpacing) >= 2, parseFloat(style.fontSize) >= 36]; });
  assert.deepEqual(date, ["uppercase", "700", true, true]);
  // The button leads down to the call for proposals, on this page.
  const call = page.locator(".ph-event-hero a.btn", { hasText: "Call for proposals" });
  const target = new URL(await call.evaluate(node => node.href));
  assert.deepEqual([target.pathname, target.hash], ["/events/tensor-talks/", "#cfp"]);
  await call.click();
  await page.waitForFunction(() => { const box = document.querySelector("#cfp-heading").getBoundingClientRect(); return box.top >= 80 && box.bottom <= innerHeight; });
  assert.equal(await page.title(), "Tensor Talks: Initialized | PyTorch Philippines");
  assert.deepEqual(errors, []);
});

test("Tensor Talks: a countdown to 1:00 PM Philippine time on the day, then the introduction in ordinary text and the figures", async t => {
  const { page, errors } = await open(t, "/events/tensor-talks/", 1440, { motion: "no-preference" });
  // From noon on November 20, 2026 in Manila to 1:00 PM on January 23: 64 days and one hour.
  assert.deepEqual(await countdown(page), ["9 weeks", "1 days", "1 hours", "0 minutes", "0 seconds"]);
  assert.equal(await page.locator(".ph-countdown").getAttribute("role"), "timer");
  assert.ok(await page.locator(".ph-countdown").isVisible());
  // Each ring is filled by its share: 9 of 52 weeks, 1 of 7 days.
  assert.deepEqual(await page.locator(".ph-countdown-ring").evaluateAll(nodes => nodes.slice(0, 2).map(node => Number(node.style.getPropertyValue("--part")).toFixed(3))), [(9 / 52).toFixed(3), (1 / 7).toFixed(3)]);
  // The introduction, as on PyTorch Day Japan's page: two paragraphs of body text (not a display
  // statement) in a column centered under the countdown, with lines of a readable length.
  const intro = page.locator(".ph-event-intro-text p");
  assert.equal(await intro.count(), 2);
  assert.match(await textOf(intro.nth(0)), /^Tensor Talks is PyTorch Philippines' technical talk series on how modern AI systems are built.*taught by local speakers\.$/);
  assert.match(await textOf(intro.nth(1)), /^Initialized is the first edition.*runs every two months and is run by community volunteers\.$/);
  const sizes = await intro.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  assert.ok(sizes.every(size => size >= 18 && size < 24), JSON.stringify(sizes));
  const column = await page.locator(".ph-event-intro-text").evaluate(node => { const box = node.getBoundingClientRect(); return { center: (box.left + box.right) / 2 - innerWidth / 2, width: box.width }; });
  assert.ok(Math.abs(column.center) < 2 && column.width <= 880, JSON.stringify(column));
  assert.equal(await page.locator(".ph-event-box").count(), 0);
  assert.deepEqual(await stats(page), [["1:00 to 6:00 PM", "Time"], ["12:30 PM", "Doors open"], ["Free", "Admission"], ["60", "Attendees planned"]]);
  const text = await ownText(page);
  for (const once of ["January 23, 2027", "entative", "1:00 to 6:00 PM", "Metro Manila", "Free", "irst-time", "last hour", "volunteers", "every two months", "first come", "waitlist"]) assert.equal(occurrences(text, once), 1, once);
  // The page is about Tensor Talks: the other series is not brought into its text.
  assert.doesNotMatch(text, /ML & Coffee/);
  assert.deepEqual(errors, []);
});

test("the countdown ticks down, goes away once the event starts, and never shows without JavaScript", async t => {
  // Thirty seconds before 1:00 PM in Manila, with the clock running.
  const { page } = await open(t, "/events/tensor-talks/", 1440, { now: "2027-01-23T04:59:30Z", motion: "no-preference", flow: true });
  const seconds = () => page.locator('.ph-countdown [data-unit="seconds"]').evaluate(node => Number(node.textContent));
  const first = await seconds();
  assert.ok(first > 20 && first <= 30, `starts near 30 seconds: ${first}`);
  assert.deepEqual((await countdown(page)).slice(0, 4), ["0 weeks", "0 days", "0 hours", "0 minutes"]);
  await page.clock.fastForward(10000);
  await page.waitForFunction(value => Number(document.querySelector('.ph-countdown [data-unit="seconds"]').textContent) <= value - 10, first);
  await page.clock.fastForward(30000);
  await page.waitForFunction(() => document.querySelector(".ph-countdown").hidden);
  // Once hidden it stops: its timer is cleared, so nothing writes to it again, not even the same value.
  await page.evaluate(() => {
    window.countdownWrites = 0;
    new MutationObserver(records => { window.countdownWrites += records.length; }).observe(document.querySelector(".ph-countdown"), { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await page.clock.fastForward(5000);
  await page.evaluate(() => new Promise(done => setTimeout(done, 0)));
  assert.equal(await page.evaluate(() => window.countdownWrites), 0);
  const started = await open(t, "/events/tensor-talks/", 1440, { now: "2027-01-23T05:00:00Z" });
  assert.ok(await started.page.locator(".ph-countdown").isHidden());
  const plain = await open(t, "/events/tensor-talks/", 1440, { javaScript: false });
  assert.ok(await plain.page.locator(".ph-countdown").isHidden());
  assert.equal(await textOf(plain.page.locator(".ph-event-date")), "January 23, 2027");
});

test("for people who ask for less motion the countdown has no seconds ring", async t => {
  const { page } = await open(t, "/events/tensor-talks/", 1440, { motion: "reduce" });
  assert.deepEqual(await countdown(page), ["9 weeks", "1 days", "1 hours", "0 minutes"]);
});

// Every event is presented the same way: the same five rings. Where no start time is stated the
// countdown runs to the start of the event's day in the Philippines.
test("ML & Coffee and Torch Trials have the same five-ring countdown as Tensor Talks", async t => {
  const units = page => page.locator(".ph-countdown li").evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\d+/, "").trim()));
  const talks = await open(t, "/events/tensor-talks/", 1440, { motion: "no-preference" });
  for (const [path, expected] of [["/events/ml-and-coffee/", ["13 weeks", "0 days", "12 hours", "0 minutes", "0 seconds"]], ["/events/torch-trials/", ["17 weeks", "0 days", "12 hours", "0 minutes", "0 seconds"]]]) {
    const { page } = await open(t, path, 1440, { motion: "no-preference" });
    assert.deepEqual(await units(page), ["Weeks", "Days", "Hours", "Minutes", "Seconds"]);
    assert.deepEqual(await units(page), await units(talks.page));
    assert.deepEqual(await countdown(page), expected, path); // from noon on November 20 to midnight on the day
    const box = node => node.getBoundingClientRect().toJSON();
    assert.deepEqual(await page.locator(".ph-countdown-ring").first().evaluate(node => [node.offsetWidth, node.offsetHeight]), await talks.page.locator(".ph-countdown-ring").first().evaluate(node => [node.offsetWidth, node.offsetHeight]));
  }
});

test("Tensor Talks' call for proposals is part of the page: a menu of its sections, and each section under a bar", async t => {
  const { page, errors } = await open(t, CFP);
  // One page, no separate call page left behind.
  assert.equal(existsSync(resolve(site, "events/tensor-talks/cfp")), false);
  assert.equal(await textOf(page.locator("#cfp h2")), "Call for proposals");
  // The heading sits over the sections, centered on their bars, and the menu starts level with the first bar.
  const line = await page.evaluate(() => {
    const center = node => { const box = node.getBoundingClientRect(); return (box.left + box.right) / 2; };
    return { off: center(document.querySelector("#cfp-heading")) - center(document.querySelector("#cfp .ph-event-bar")), menu: document.querySelector(".ph-cfp-nav").getBoundingClientRect().top - document.querySelector("#cfp .ph-event-bar").getBoundingClientRect().top };
  });
  assert.ok(Math.abs(line.off) < 2 && Math.abs(line.menu) < 24, JSON.stringify(line));
  assert.deepEqual(await page.locator("#cfp-heading").evaluate(node => { const style = getComputedStyle(node); return [style.textAlign, style.textTransform]; }), ["center", "uppercase"]);
  const titles = ["Overview", "Dates to remember", "Tracks", "Submission types", "Important notes", "How proposals are reviewed"];
  assert.deepEqual(await textsOf(page.locator(".ph-cfp-body > section > h3.ph-event-bar")), titles);
  assert.deepEqual(await textsOf(page.locator(".ph-cfp-nav a")), titles);
  // Every menu entry leads to its section.
  const targets = await page.locator(".ph-cfp-nav a").evaluateAll(nodes => nodes.map(node => document.querySelector(new URL(node.href).hash)?.querySelector("h3")?.textContent.trim()));
  assert.deepEqual(targets, titles);
  // The menu sits left of the sections and stays in view while they scroll.
  const [nav, body] = await page.locator(".ph-cfp-nav, .ph-cfp-body").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  assert.ok(nav.right <= body.left);
  await page.locator("#review").scrollIntoViewIfNeeded();
  assert.ok(await page.locator(".ph-cfp-nav").evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 90 && box.bottom <= innerHeight; }), "menu still on screen, below the header");
  // A menu entry brings its section's bar into view, clear of the header.
  await page.locator(".ph-cfp-nav a").nth(2).click();
  await page.waitForFunction(() => { const box = document.querySelector("#tracks-heading").getBoundingClientRect(); return box.top >= 90 && box.top < innerHeight / 2; });
  // Bars: rounded, centered capitals, white on the gradient.
  assert.deepEqual(await page.locator(".ph-event-bar").first().evaluate(node => { const style = getComputedStyle(node); return [style.borderTopLeftRadius, style.textAlign, style.textTransform, style.color, style.backgroundImage.startsWith("linear-gradient")]; }), ["8px", "center", "uppercase", "rgb(255, 255, 255)", true]);
  // Headings step down in order: the page's name, the call, its sections.
  assert.deepEqual(await page.locator("main").evaluate(node => [...new Set([...node.querySelectorAll("#hero-heading, #cfp h2, #cfp h3")].map(heading => heading.tagName))]), ["H1", "H2", "H3"]);
  assert.deepEqual(errors, []);
});

test("the call for proposals states the tracks, the levels, the two submission types, the notes and how talks are chosen", async t => {
  const { page, errors } = await open(t, CFP);
  // The program comes from the open call, with one stated exception: a talk by the venue host.
  assert.match(await textOf(page.locator("#overview")), /^Overview Talks on the program come from this open call, apart from one given by the venue host\..*First-time speakers are welcome\./);
  assert.doesNotMatch(await textOf(page.locator("main")), /Every talk on the program/);
  assert.match(await textOf(page.locator("#review")), /scores every proposal from the call with speaker names hidden/);
  // Each track is defined, as the Linux Foundation's "Suggested Topics" are: the name, then what it covers.
  assert.deepEqual(await textsOf(page.locator(".ph-tracks li strong")), ["Training and Post-Training:", "Inference and Deployment:", "Math and Foundations:", "Agents and Applications:", "PyTorch Ecosystem:"]);
  const definitions = await page.locator(".ph-tracks li").evaluateAll(nodes => nodes.map(node => node.textContent.replace(node.querySelector("strong").textContent, "").trim()));
  assert.ok(definitions.every(text => text.length > 80 && /Topics include/.test(text)), JSON.stringify(definitions.map(text => text.length)));
  assert.match(definitions[0], /^Model training, fine-tuning, and alignment/);
  assert.match(definitions[1], /^Deploying models as reliable, continuously running services/);
  assert.match(definitions[4], /vLLM, DeepSpeed, Ray, Helion, Safetensors and others/);
  assert.match(await textOf(page.locator(".ph-levels")), /Beginner, Intermediate or Advanced/);
  // The submission types, set out as theirs: the type with its length and speakers in bold, one line
  // on what it is, and the speaker line-up rule as a note under sessions.
  const types = page.locator(".ph-formats > li");
  assert.deepEqual(await textsOf(types.locator("> strong")), ["Session (20 to 30 minutes, up to 3 speakers):", "Lightning talk (10 to 15 minutes, up to 2 speakers):"]);
  assert.match(await textOf(types.nth(0)), /A focused talk covering a specific topic, concept, or case study, including Q&A\./);
  assert.match(await textOf(types.nth(0).locator(".ph-chevron-note li")), /^Note: a talk with three or more speakers can't have only men on stage\./);
  assert.equal(await types.nth(0).locator(".ph-chevron-note li").evaluate(node => getComputedStyle(node).fontStyle), "italic");
  assert.match(await textOf(types.nth(1)), /A fast-paced, high-impact presentation.*no Q&A on stage.*first technical talk\./);
  assert.equal(await types.nth(1).locator(".ph-chevron-note").count(), 0);
  assert.match(await textOf(page.locator(".ph-formats-note")), /Your acceptance email will state it/);
  assert.equal(await page.locator(".ph-rules li").count(), 7);
  assert.equal(await textOf(page.locator(".ph-rules li").nth(6)), "Speakers receive a printed certificate.");
  assert.match(await textOf(page.locator(".ph-rules li").nth(0)), /^Submit up to two proposals\./);
  assert.equal(await page.locator('.ph-rules a[href="https://events.linuxfoundation.org/about/code-of-conduct/"]').count(), 1);
  // Every chevron list says it is a list (Safari drops that from a list without markers).
  const lists = await page.locator("ul.ph-chevrons").evaluateAll(nodes => nodes.map(node => node.getAttribute("role")));
  assert.ok(lists.length === 5 && lists.every(role => role === "list"), JSON.stringify(lists));
  // Lists carry a chevron, as on the Linux Foundation's pages.
  assert.notEqual(await page.locator(".ph-chevrons li").first().evaluate(node => getComputedStyle(node, "::before").borderRightStyle), "none");
  // The Sessionize link is not published yet: no button, and no dead link.
  assert.equal(await page.locator("main a").evaluateAll(nodes => nodes.filter(node => /sessionize/i.test(node.href) || !node.getAttribute("href")).length), 0);
  assert.equal(await page.locator(".ph-cfp-submit").count(), 0);
  const text = await ownText(page);
  for (const once of ["November 18", "December 6", "December 14", "Code of Conduct", "ertificate", "11:59 PM", "volunteers", "only men", "PyTorch and its ecosystem"]) assert.equal(occurrences(text, once), 1, once);
  assert.deepEqual(errors, []);
});

test("dates to remember run in order, each once, with the call's own dates from the data file; the next one is tagged", async t => {
  const { page, errors } = await open(t, CFP);
  const items = page.locator(".ph-key-dates li");
  // The last three follow the event's day (January 23): five, three and one day before it.
  assert.deepEqual(await items.locator("time").evaluateAll(nodes => nodes.map(node => node.getAttribute("datetime"))), ["2026-11-18", "2026-12-06", "2026-12-14", "2026-12-18", "2026-12-21", "2027-01-18", "2027-01-20", "2027-01-22"]);
  assert.deepEqual(await textsOf(items.locator("time")), ["Wednesday, November 18, 2026", "Sunday, December 6, 2026", "Monday, December 14, 2026", "Friday, December 18, 2026", "Monday, December 21, 2026", "Monday, January 18, 2027", "Wednesday, January 20, 2027", "Friday, January 22, 2027"]);
  assert.doesNotMatch(await textOf(page.locator("main")), /January 1[1356]\b/, "no date left from the earlier day");
  // They are said to follow the event's day, which may still move.
  assert.equal(await textOf(page.locator("#dates .ph-dates-note")), "The January dates move with the event's day if it changes.");
  assert.deepEqual(await textsOf(items.locator("strong")), ["CFP opens:", "CFP closes:", "Speakers notified:", "Confirm your talk by:", "Schedule published and registration opens:", "Registration closes:", "Lightning talk slides due:", "Session slides due:"]);
  assert.match(await textOf(items.nth(1)), /at 11:59 PM, Philippine time/);
  // On November 20 the opening has passed and the closing is next.
  assert.deepEqual(await items.evaluateAll(nodes => nodes.map(node => [node.classList.contains("is-past"), node.classList.contains("is-next")])), [[true, false], [false, true], ...Array(6).fill([false, false])]);
  // Said in words and shapes, not by color alone: a visible "Next" tag, and a check mark for a passed date.
  assert.equal(await textOf(items.nth(1).locator(".ph-date-tag")), "Next");
  assert.ok(await items.nth(1).locator(".ph-date-tag").isVisible());
  // The tag stands clear of the text before it.
  const room = await items.nth(1).evaluate(node => {
    const range = document.createRange();
    range.setStartBefore(node.firstChild);
    range.setEndBefore(node.querySelector(".ph-date-tag"));
    const rects = [...range.getClientRects()], tag = node.querySelector(".ph-date-tag").getBoundingClientRect();
    return tag.left - Math.max(...rects.filter(rect => Math.abs(rect.top - tag.top) < 12).map(rect => rect.right));
  });
  assert.ok(room >= 10, `the tag has ${room}px of room`);
  assert.equal(await page.locator(".ph-date-tag").count(), 1);
  assert.equal(await textOf(items.nth(0).locator(".ph-visually-hidden")), "(passed)");
  const marks = await items.evaluateAll(nodes => nodes.slice(0, 2).map(node => { const style = getComputedStyle(node, "::before"); return `${style.width} ${style.height}`; }));
  assert.notEqual(marks[0], marks[1], "a passed date has a different mark");
  assert.deepEqual(errors, []);
});

test("a date stays next through its own day in Manila; without JavaScript every date reads the same", async t => {
  const sameDay = await open(t, CFP, 1440, { now: "2026-12-06T10:00:00Z" });
  assert.equal(await sameDay.page.locator(".ph-key-dates li.is-next time").getAttribute("datetime"), "2026-12-06");
  const after = await open(t, CFP, 1440, { now: "2026-12-06T17:00:00Z" }); // 1 AM on December 7 in Manila
  assert.equal(await after.page.locator(".ph-key-dates li.is-next time").getAttribute("datetime"), "2026-12-14");
  assert.equal(await after.page.locator(".ph-key-dates li.is-past").count(), 2);
  const plain = await open(t, CFP, 1440, { javaScript: false });
  assert.equal(await plain.page.locator(".ph-key-dates li").count(), 8);
  assert.equal(await plain.page.locator(".ph-key-dates li.is-past, .ph-key-dates li.is-next, .ph-date-tag").count(), 0);
});

test("without a stated start time the countdown ends when the day begins in Manila", async t => {
  const eve = await open(t, "/events/ml-and-coffee/", 1440, { now: "2027-02-19T15:30:00Z" }); // 11:30 PM on February 19 in Manila
  assert.deepEqual(await countdown(eve.page), ["0 weeks", "0 days", "0 hours", "30 minutes"]);
  const day = await open(t, "/events/ml-and-coffee/", 1440, { now: "2027-02-19T16:30:00Z" }); // 12:30 AM on February 20
  assert.ok(await day.page.locator(".ph-countdown").isHidden());
});

// Registration is on Luma. As on the Linux Foundation's event pages, Register is the first button in
// the hero; here it follows the registration window (December 21 to January 18, Philippine time).
test("Tensor Talks: Register leads to Luma only while registration is open; before and after, a label says so", async t => {
  const LUMA = "https://luma.com/b6k2ve9l";
  const state = async page => ({
    hero: await page.locator(".ph-event-hero .ph-hero-actions > *").evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll("a, .ph-event-chip"), ...(node.matches("a") ? [node] : [])].filter(part => part.getClientRects().length).map(part => `${part.tagName === "A" ? "link" : "label"}: ${part.textContent.trim()}`)).flat()),
    lumaLinks: await page.locator(`main a[href="${LUMA}"]`).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => node.textContent.trim())),
  });
  // Before it opens: the label, and no way through to a page that would say "closed".
  const before = await open(t, "/events/tensor-talks/");
  assert.deepEqual(await state(before.page), { hero: ["label: Registration not yet open", "link: Call for proposals"], lumaLinks: [] });
  // The opening date is said once on the page, in the dates to remember.
  assert.equal(occurrences(await ownText(before.page), "December 21"), 1);
  // The label is plainly not a button: no link, outlined, readable on the hero.
  assert.deepEqual(await before.page.locator(".ph-event-hero .ph-event-chip").evaluate(node => { const style = getComputedStyle(node); return [node.tagName, style.color, style.backgroundColor, style.borderTopStyle]; }), ["SPAN", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "solid"]);
  // The band under the introduction says how attendees are selected, whatever the date.
  const band = before.page.locator("#registration");
  assert.equal(await textOf(band.locator("h2")), "Registration");
  assert.match(await textOf(band.locator(".ph-event-band-text")), /^This is not first come, first served\..*GitHub or Hugging Face profile\..*waitlist\. Up to four places are held for the venue host's team\.$/);
  assert.ok(await band.locator(".ph-event-gate").isHidden(), "no button in the band before registration opens");
  // From the opening day through the closing day: Register, in the hero and in the band.
  for (const now of ["2026-12-20T16:30:00Z", "2027-01-18T15:30:00Z"]) { // 12:30 AM on December 21 and 11:30 PM on January 18, in Manila
    const { page } = await open(t, "/events/tensor-talks/", 1440, { now });
    assert.deepEqual(await state(page), { hero: ["link: Register", "link: Call for proposals"], lumaLinks: ["Register", "Register on Luma"] }, now);
    assert.equal(await page.locator(".ph-event-hero .ph-event-gate a").getAttribute("rel"), "noopener noreferrer");
  }
  // After it closes.
  const after = await open(t, "/events/tensor-talks/", 1440, { now: "2027-01-18T16:30:00Z" }); // 12:30 AM on January 19
  assert.deepEqual(await state(after.page), { hero: ["label: Registration closed", "link: Call for proposals"], lumaLinks: [] });
  // Without JavaScript the link is there: Luma itself says whether registration is open.
  const plain = await open(t, "/events/tensor-talks/", 1440, { javaScript: false });
  assert.equal(await plain.page.locator(".ph-event-hero .ph-event-gate a").getAttribute("href"), LUMA);
  // The other events have no registration yet, so no Register button and no band.
  const other = await open(t, "/events/ml-and-coffee/");
  assert.equal(await other.page.locator(".ph-event-gate, #registration").count(), 0);
});

// The Sessionize link is not in the data file yet, so the page is served here with the button the
// template writes once it is, to check that it follows the call's window as the home page's tile does.
test("once there is a Sessionize link, the submit button shows only while the call is open", async t => {
  const button = '<div class="ph-cfp-submit ph-event-gate" data-gate data-opens="2026-11-18" data-closes="2026-12-06" data-after="CFP closed"><a class="ph-event-button" href="https://sessionize.com/example/" rel="noopener noreferrer">Submit a proposal</a></div>';
  const rewrite = html => html.replace("<p>First-time speakers are welcome.</p>", `<p>First-time speakers are welcome.</p>${button}`);
  assert.equal(await (await open(t, CFP, 1440, { rewrite })).page.locator(".ph-cfp-submit").count(), 1, "the page takes the button");
  const early = await open(t, CFP, 1440, { rewrite, now: "2026-11-17T04:00:00Z" });
  assert.ok(await early.page.locator(".ph-cfp-submit").isHidden(), "not before the opening day");
  for (const now of ["2026-11-17T16:30:00Z", NOW, "2026-12-06T15:30:00Z"]) { // 12:30 AM on November 18 to 11:30 PM on December 6, in Manila
    const { page } = await open(t, CFP, 1440, { rewrite, now });
    assert.equal(await textOf(page.locator(".ph-cfp-submit a")), "Submit a proposal", now);
    assert.ok(await page.locator(".ph-cfp-submit a").isVisible(), now);
    assert.deepEqual(await page.locator(".ph-cfp-submit a").evaluate(node => { const style = getComputedStyle(node); return [style.color, style.textDecorationLine]; }), ["rgb(255, 255, 255)", "none"]);
  }
  const late = await open(t, CFP, 1440, { rewrite, now: "2026-12-06T16:30:00Z" }); // 12:30 AM on December 7 in Manila
  assert.equal(await textOf(late.page.locator(".ph-cfp-submit .ph-event-chip")), "CFP closed");
  assert.ok(await late.page.locator(".ph-cfp-submit a").isHidden());
  assert.ok(await late.page.locator(".ph-cfp-submit .ph-event-chip").isVisible());
});

test("a page left open over midnight in Manila moves on by itself: the call closes and the next date changes", async t => {
  const button = '<div class="ph-cfp-submit ph-event-gate" data-gate data-opens="2026-11-18" data-closes="2026-12-06" data-after="CFP closed"><a class="ph-event-button" href="https://sessionize.com/example/" rel="noopener noreferrer">Submit a proposal</a></div>';
  const rewrite = html => html.replace("<p>First-time speakers are welcome.</p>", `<p>First-time speakers are welcome.</p>${button}`);
  const { page } = await open(t, CFP, 1440, { rewrite, now: "2026-12-06T15:59:00Z", flow: true }); // 11:59 PM on December 6
  assert.ok(await page.locator(".ph-cfp-submit a").isVisible());
  assert.equal(await page.locator(".ph-key-dates li.is-next time").getAttribute("datetime"), "2026-12-06");
  await page.clock.fastForward(120000);
  await page.waitForFunction(() => document.querySelector(".ph-key-dates li.is-next time").getAttribute("datetime") === "2026-12-14");
  assert.ok(await page.locator(".ph-cfp-submit a").isHidden());
  assert.equal(await textOf(page.locator(".ph-cfp-submit .ph-event-chip")), "CFP closed");
  // Marked once each: one tag, and one "(passed)" per passed date.
  assert.equal(await page.locator(".ph-date-tag").count(), 1);
  assert.equal(await page.locator(".ph-key-dates li.is-past .ph-visually-hidden").count(), 2);
});

test("a button keeps 4.5:1 when hovered, and the section menu hands keyboard focus to the section it opens", async t => {
  const { page } = await open(t, CFP);
  const button = page.locator(".ph-more-events .ph-event-button");
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  assert.deepEqual(await button.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.color]; }), ["rgb(190, 44, 16)", "rgb(255, 255, 255)"]); // 5.9:1
  await page.locator(".ph-cfp-nav a").nth(4).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "notes");
  await page.keyboard.press("Tab");
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Code of Conduct/, "Tab goes on inside the section");
});

test("ML & Coffee: the date, the introduction and figures, then talk proposals with the levels and Tensor Talks' tracks", async t => {
  const { page, errors } = await open(t, "/events/ml-and-coffee/");
  assert.equal(await textOf(page.locator("h1")), "ML & Coffee");
  assert.equal(await textOf(page.locator(".ph-event-kind")), "Meetup");
  assert.deepEqual(await hero(page), ["February 20, 2027", "Saturday, tentative"]);
  assert.equal(await page.locator(".ph-countdown").getAttribute("aria-label"), "Time until February 20, 2027");
  assert.match(await textOf(page.locator(".ph-event-intro-text")), /^ML & Coffee is PyTorch Philippines' meetup for people interested in machine learning, at any experience level\./);
  assert.deepEqual(await stats(page), [["40", "Attendees planned"], ["3", "Talk levels"], ["5", "Tracks"]]);
  // Networking is said in the introduction, as on Tensor Talks' page, not set apart as a figure.
  assert.match(await textOf(page.locator(".ph-event-intro-text")), /short talks open the program, followed by a networking session\.$/);
  assert.doesNotMatch(await textOf(page.locator(".ph-event-stats")), /network|hour/i);
  // The same form as Tensor Talks' call: a heading, a menu, and each section under a bar.
  const talks = page.locator("#talks");
  assert.equal(await textOf(talks.locator("h2")), "Talk proposals");
  const titles = ["Overview", "Levels", "Tracks"];
  assert.deepEqual(await textsOf(talks.locator(".ph-cfp-body > section > h3.ph-event-bar")), titles);
  assert.deepEqual(await textsOf(talks.locator(".ph-cfp-nav a")), titles);
  assert.deepEqual(await textsOf(talks.locator("#levels li strong")), ["Ignite:", "Personal and fun projects:", "Industry and real-world impact:"]);
  // The figures count what the lists show.
  assert.equal(await talks.locator("#levels li").count(), 3);
  assert.equal(await talks.locator("#tracks li").count(), 5);
  // The same tracks as Tensor Talks, from one list in the data file.
  const tracks = await textsOf(talks.locator("#tracks li"));
  const other = await open(t, "/events/tensor-talks/");
  assert.deepEqual(tracks, await textsOf(other.page.locator("#tracks li")));
  assert.match(tracks[4], /^PyTorch Ecosystem: Tools and community contributions built on PyTorch.*vLLM, DeepSpeed, Ray, Helion, Safetensors and others\./);
  assert.ok(tracks.every(track => /Topics include/.test(track)), "each track is defined");
  assert.match(await textOf(talks.locator("#overview")), /Talks are chosen from submitted proposals, which are grouped into three levels\.$/);
  // No dates or link for proposals are stated yet, so none are shown.
  assert.equal(await talks.locator("time, a.ph-event-button, .ph-key-dates").count(), 0);
  const text = await ownText(page);
  for (const once of ["February 20, 2027", "entative", "Ignite", "experience level", "etworking"]) assert.equal(occurrences(text, once), 1, once);
  assert.doesNotMatch(text, /Tensor Talks/);
  assert.deepEqual(errors, []);
});

test("Torch Trials: the date, what it is for, the figures, and its themes", async t => {
  const { page, errors } = await open(t, "/events/torch-trials/");
  assert.equal(await textOf(page.locator("h1")), "Torch Trials");
  assert.equal(await textOf(page.locator(".ph-event-kind")), "Hackathon");
  assert.deepEqual(await hero(page), ["March 20, 2027", "Saturday, tentative"]);
  assert.deepEqual(await countdown(page), ["17 weeks", "0 days", "12 hours", "0 minutes"]); // to the start of March 20; no seconds ring under reduced motion
  const intro = page.locator(".ph-event-intro-text p");
  assert.equal(await intro.count(), 2);
  assert.match(await textOf(intro.nth(0)), /^Torch Trials is PyTorch Philippines' ML-focused hackathon series\..*run experiments, test ideas, benchmark results, and present their findings/);
  assert.match(await textOf(intro.nth(1)), /hands-on environment.*research-oriented challenges.*reproducible, evidence-driven problem solving\.$/);
  assert.deepEqual(await stats(page), [["20", "Professionals planned"], ["30", "Students planned"]]);
  assert.equal(await textOf(page.locator(".ph-event-band h2")), "Built around themes like");
  assert.deepEqual(await textsOf(page.locator(".ph-event-cards li")), ["Model training", "Inference", "Speculative decoding", "Quantization", "Evaluation"]);
  const text = await ownText(page);
  for (const once of ["March 20, 2027", "entative", "Quantization", "peculative decoding", "enchmark", "findings"]) assert.equal(occurrences(text, once), 1, once);
  assert.deepEqual(errors, []);
});

for (const slug of PAGES) {
  test(`${slug}: the page ends with the other two events, as tiles that lead to their pages`, async t => {
    const { page } = await open(t, `/events/${slug}/`);
    const others = PAGES.filter(other => other !== slug).map(other => `/events/${other}/`);
    const tiles = page.locator(".ph-more-events .ph-tile");
    assert.deepEqual(await tiles.locator("h3 a").evaluateAll(nodes => nodes.map(node => new URL(node.href).pathname)), others);
    assert.equal(await page.locator(".ph-more-events a").evaluateAll(nodes => nodes.filter(node => new URL(node.href).pathname === "/events/").length), 1, "one link back to the directory");
    assert.deepEqual(await page.locator(".ph-more-events .ph-event-button").evaluate(node => { const style = getComputedStyle(node); return [style.color, style.textDecorationLine, style.borderTopLeftRadius]; }), ["rgb(255, 255, 255)", "none", "8px"]);
    // The whole tile is the link: a click on its empty corner opens the page.
    await tiles.nth(0).scrollIntoViewIfNeeded();
    const box = await tiles.nth(0).boundingBox();
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
    await page.waitForURL(url => url.pathname === others[0]);
  });
}

for (const path of ALL) {
  test(`${path}: only what the organizers have stated is on the page`, () => {
    const html = built(path);
    const main = html.match(/<main[\s\S]*<\/main>/)[0];
    for (const banned of [/₱|PHP|USD|\$\d/, /budget|funding|sponsor|pizza|contingency|speaker fees|travel|accommodation/i, /Meta Office|French Tech/i, /gmail|proton\.me|@/i, /\bTBA\b|to be announced|to be named|coming soon/i, /Plan [AB]\b/, /Project head|in-charge|committee:|Crew|ingress|Secretariat/i, /Demo\/Test/]) {
      assert.doesNotMatch(main, banned);
    }
    // Anywhere on the page, the only address is the community's own.
    for (const address of html.match(/[\w.+-]+@[a-z][\w-]*(?:\.[a-z][\w-]*)+/gi) ?? []) assert.match(address, /@pytorch\.ph$/, address);
    assert.doesNotMatch(html, /gmail\.com|proton\.me|sessionize\.com/i);
  });

  for (const [width, floor] of [[1440, 16], [390, 15]]) {
    test(`${path} at ${width}px: no text under ${floor}px, nothing wider than the screen, nothing oversized in the body`, async t => {
      const { page, errors } = await open(t, path, width);
      const sizes = await page.evaluate(() => {
        const found = [];
        const walk = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) {
          const node = walk.currentNode, parent = node.parentElement;
          if (!node.textContent.trim() || !parent.getClientRects().length || parent.closest(".ph-visually-hidden, script, noscript")) continue;
          found.push({ where: parent.className || parent.tagName, hero: Boolean(parent.closest(".ph-hero")), size: parseFloat(getComputedStyle(parent).fontSize), text: node.textContent.trim().slice(0, 30) });
        }
        return found;
      });
      assert.ok(sizes.length > 10, "the page has text to measure");
      assert.deepEqual(sizes.filter(item => item.size < floor), []);
      // Below the hero nothing is set as a display statement: headings and figures stay at 32px or less.
      assert.deepEqual(sizes.filter(item => !item.hero && item.size > 32), []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll");
      // No figure or label is cut or broken mid-word: each fits its box.
      const tight = await page.locator(".ph-event-stats li > *").evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth).map(node => node.textContent));
      assert.deepEqual(tight, []);
      assert.ok(await page.locator(".ph-event-stats li").count() >= 2);
      // Nothing in a row is cut or wrapped mid-word: every countdown label stays on one line.
      const labels = await page.locator(".ph-countdown li").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height).filter(Boolean));
      assert.ok(labels.length >= 2 && new Set(labels.map(Math.round)).size === 1, JSON.stringify(labels));
      assert.deepEqual(errors, []);
    });
  }
}

for (const width of [320, 390]) {
  test(`at ${width}px all five rings of the countdown fit in one row, on every event's page`, async t => {
    for (const path of ALL) {
      const { page } = await open(t, path, width, { motion: "no-preference" });
      const boxes = await page.locator(".ph-countdown li").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => { const box = node.getBoundingClientRect(); return [Math.round(box.left), Math.round(box.right), Math.round(box.top), Math.round(box.height)]; }));
      assert.equal(boxes.length, 5, path);
      assert.ok(boxes.every(([left, right]) => left >= 0 && right <= width), `${path} ${JSON.stringify(boxes)}`);
      assert.equal(new Set(boxes.map(box => `${box[2]} ${box[3]}`)).size, 1, `${path}: one row, no label wrapped`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path);
    }
  });
}

test("on a phone the hero stacks, the figures pair up, and the call's menu gives way to its sections", async t => {
  const { page } = await open(t, "/events/tensor-talks/", 390);
  const [name, when] = await page.locator(".ph-event-hero-layout > div").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  assert.ok(name.bottom <= when.top && name.left === when.left);
  const lefts = await page.locator(".ph-event-stats > li").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size, 2);
  assert.ok(await page.locator(".ph-cfp-nav").isHidden());
  assert.ok(await page.locator("#dates").isVisible());
});
