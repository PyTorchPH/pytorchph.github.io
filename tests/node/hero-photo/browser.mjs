// Drives the built home page (frontend/public-site/_site) in Chromium and checks the hero crossfade:
// only the first photo loads with the page and the others after it, at the size the screen uses;
// the photos advance; "Pause photos" stops and resumes them; and visitors who prefer reduced motion
// get the first photo only, with no button. Takes about 30 seconds (each photo shows for 7 s).
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
    const toggle = page.locator("[data-hero-slides-toggle]");
    assert.equal(await toggle.isVisible(), true);
    assert.equal(await toggle.textContent(), "Pause photos");
    assert.equal(await active(page), "manila_post_office");
    const requests = await heroRequests(page);
    assert.deepEqual(requests.filter(request => !request.afterLoad).map(request => request.file), ["manila-post-office-night.jpg"], "only the first photo loads with the page");
    assert.deepEqual(requests.map(request => request.file).sort(), ["fort-santiago-gate.jpg", "manila-bay-sunset.jpg", "manila-post-office-night.jpg", "rizal-monument-night.jpg"], "wide screens load the wide photos only");
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "rizal_monument", null, { timeout: 10000 });
    assert.notEqual(await page.locator(".ph-hero-slide.is-active").evaluate(node => getComputedStyle(node).backgroundImage), "none");
    // Paused, the photo stays; resumed, it advances again.
    await toggle.click();
    assert.equal(await toggle.textContent(), "Play photos");
    await page.waitForTimeout(8500);
    assert.equal(await active(page), "rizal_monument", "paused photos do not advance");
    await toggle.click();
    assert.equal(await toggle.textContent(), "Pause photos");
    await page.waitForFunction(() => document.querySelector(".ph-hero-slide.is-active")?.dataset.heroPhoto === "fort_santiago", null, { timeout: 10000 });
    assert.equal(await page.locator(".ph-hero-slide.is-active").count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Phone: the 3:4 photos, never the wide ones.
  {
    const { context, page, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.waitForSelector(".ph-hero-slides.is-playing", { timeout: 15000 });
    const files = (await heroRequests(page)).map(request => request.file).sort();
    assert.deepEqual(files, ["fort-santiago-gate-portrait.jpg", "manila-bay-sunset-portrait.jpg", "manila-post-office-night-portrait.jpg", "rizal-monument-night-portrait.jpg"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Reduced motion: the first photo only, no crossfade, no button.
  {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.waitForTimeout(2000);
    assert.equal(await page.locator(".ph-hero-slides.is-playing").count(), 0);
    assert.equal(await page.locator("[data-hero-slides-toggle]").isVisible(), false);
    assert.equal(await active(page), "manila_post_office");
    assert.deepEqual((await heroRequests(page)).map(request => request.file), ["manila-post-office-night.jpg"]);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ event: "hero_photo.browser_verified", outcome: "success", checks: ["first-photo-only-before-load", "wide-and-portrait-sizes", "advances", "pause-and-resume", "reduced-motion", "no-overflow"] }));
