// Drives the built home page (frontend/public-site/_site) in Chromium and checks the hero crossfade:
// only the first photo loads with the page and the others after it, at the size the screen uses;
// the photos advance, also after the screen crosses the breakpoint; and visitors who prefer reduced
// motion get the first photo only. There is no pause button (the site owner asked for none). Takes
// about 40 seconds (each photo shows for 7 s).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
assert.ok(existsSync(resolve(site, "index.html")), "Build the public Pages site first");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer((request, response) => {
  let path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(site, `.${path}`);
  if (!file.startsWith(site) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

const active = page => page.locator(".ph-hero-slide.is-active").getAttribute("data-hero-photo");
// Hero photo requests, with whether each started after the page's load event (same clock).
const heroRequests = page => page.evaluate(() => {
  const loaded = performance.getEntriesByType("navigation")[0].loadEventStart;
  return performance.getEntriesByType("resource").filter(entry => entry.name.includes("/assets/images/hero/"))
    .map(entry => ({ file: new URL(entry.name).pathname.split("/").pop(), afterLoad: entry.startTime >= loaded }));
});
const open = async (options) => {
  const context = await browser.newContext(options);
  // Third-party requests are not part of this check.
  await context.route("**/*", route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/`, { waitUntil: "load" });
  return { context, page, errors };
};

try {
  // Wide screen: the crossfade runs on the 2:1 photos.
  {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
    await page.waitForSelector(".ph-hero-slides.is-playing", { timeout: 15000 });
    assert.equal(await page.locator("[data-hero-slides-toggle], .ph-hero button").count(), 0, "no pause button");
    assert.equal(await active(page), "rizal_monument");
    const requests = await heroRequests(page);
    assert.deepEqual(requests.filter(request => !request.afterLoad).map(request => request.file), ["rizal-monument-night.jpg"], "only the first photo loads with the page");
    assert.deepEqual(requests.map(request => request.file).sort(), ["fort-santiago-gate.jpg", "lapulapu-monument.jpg", "mount-apo.jpg", "rizal-monument-night.jpg"], "wide screens load the wide photos only");
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "lapulapu_monument", null, { timeout: 10000 });
    assert.notEqual(await page.locator(".ph-hero-slide.is-active").evaluate(node => getComputedStyle(node).backgroundImage), "none");
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "fort_santiago", null, { timeout: 10000 });
    assert.equal(await page.locator(".ph-hero-slide.is-active").count(), 1);
    // Crossing to a phone width: the portrait photos load and the crossfade carries on with them.
    const before = await page.locator(".ph-hero-slide.is-active").evaluate(node => getComputedStyle(node).backgroundImage);
    await page.setViewportSize({ width: 390, height: 844 });
    // At the moment of the change the photo on screen keeps its image instead of going blank.
    assert.equal(await page.locator(".ph-hero-slide.is-active").evaluate(node => getComputedStyle(node).backgroundImage), before);
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "mount_apo", null, { timeout: 12000 });
    const portraits = (await heroRequests(page)).map(request => request.file).filter(file => file.includes("-portrait"));
    for (const file of ["fort-santiago-gate-portrait.jpg", "mount-apo-portrait.jpg"]) assert.ok(portraits.includes(file), `${file} loads after crossing the breakpoint`);
    // Turning reduced motion on mid-visit: back to the first photo, and it stays.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "rizal_monument");
    await page.waitForTimeout(8000);
    assert.equal(await active(page), "rizal_monument", "reduced motion keeps the first photo");
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Phone: the 3:4 photos, never the wide ones.
  {
    const { context, page, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.waitForSelector(".ph-hero-slides.is-playing", { timeout: 15000 });
    const files = (await heroRequests(page)).map(request => request.file).sort();
    assert.deepEqual(files, ["fort-santiago-gate-portrait.jpg", "lapulapu-monument-portrait.jpg", "mount-apo-portrait.jpg", "rizal-monument-night-portrait.jpg"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Reduced motion: the first photo only, no crossfade.
  {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.waitForTimeout(2000);
    assert.equal(await page.locator(".ph-hero-slides.is-playing").count(), 0);
    assert.equal(await active(page), "rizal_monument");
    assert.deepEqual((await heroRequests(page)).map(request => request.file), ["rizal-monument-night.jpg"]);
    // Crossing the breakpoint: the photo keeps its image, then switches to the portrait size.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.match(await page.locator(".ph-hero-slide.is-active").evaluate(node => getComputedStyle(node).backgroundImage), /rizal-monument-night\.jpg/);
    await page.waitForFunction(() => /rizal-monument-night-portrait\.jpg/.test(getComputedStyle(document.querySelector(".ph-hero-slide.is-active")).backgroundImage));
    assert.deepEqual(errors, []);
    await context.close();
  }
  // The first photo fails to load: the crossfade leaves it out instead of fading to an empty frame.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url.includes("/assets/images/hero/rizal-monument-")) return route.abort();
      return url.startsWith(origin) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/`, { waitUntil: "load" });
    await page.waitForSelector(".ph-hero-slides.is-playing", { timeout: 15000 });
    assert.equal(await active(page), "lapulapu_monument");
    const seen = new Set();
    for (let tick = 0; tick < 24; tick++) { seen.add(await active(page)); await page.waitForTimeout(1000); }
    assert.ok(!seen.has("rizal_monument"), "the photo that failed never shows");
    assert.ok(seen.size >= 3, "the other photos keep crossfading");
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ event: "hero_photo.browser_verified", outcome: "success", checks: ["first-photo-only-before-load", "wide-and-portrait-sizes", "advances", "no-pause-button", "breakpoint-crossing", "reduced-motion", "reduced-motion-breakpoint", "failed-first-photo", "reduced-motion-mid-visit", "no-overflow"] }));
