import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { servePages } from "../../../development/pages-demo/verify/serve-pages.mjs";
import { API_ORIGIN, PHOTO_SVG, publishedDocument, publishedLeadership } from "./fixtures.mjs";

async function main() {
  // Mental model: actual built Pages + real bootstrap/modules + published GET fixtures, never live accounts.
  const root = resolve(import.meta.dirname, "../../..");
  const siteOut = resolve(root, "frontend/public-site/_site");
  assert.ok(existsSync(resolve(siteOut, "about/index.html")), "Build the public Pages site before running the About browser pass");
  const artifactDirectory = resolve(root, "var/test-artifacts/about");
  await mkdir(artifactDirectory, { recursive: true });
  const server = await servePages({ portalOut: resolve(root, "frontend/portal-static/out"), siteOut });
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const [device, viewport] of [["desktop", { width: 1440, height: 1050 }], ["mobile", { width: 390, height: 844 }]]) {
      await verifyBuiltAbout(browser, server.origin, artifactDirectory, device, viewport);
    }
  } finally {
    await browser?.close();
    await server.close();
  }
  console.log(JSON.stringify({ event: "about.pages.browser_verified", outcome: "success", checks: ["no-team-directory", "no-static-resurrection", "ambassador-portraits", "campus-labs-portraits", "campus-labs-total", "three-legacy-redirects", "single-h1", "no-horizontal-overflow"], artifacts: artifactDirectory }));
}

// The About page has no team directory (removed at the site owner's request): even when the API
// publishes a leadership roster, no person card renders. People appear only as PyTorch Foundation
// Ambassadors and as Campus Labs people, each with a portrait that loads.
async function verifyBuiltAbout(browser, origin, artifacts, device, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const state = { rows: publishedLeadership(), revision: 21, failure: false };
  const legacyPortraitRequests = [];
  await mockPublishedRequests(context, origin, state, legacyPortraitRequests);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${origin}/about/`, { waitUntil: "networkidle" });
    await expectRevision(page, state.revision);
    await assertAbout(page);
    await page.evaluate(() => document.querySelector("#ambassadors").scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: resolve(artifacts, `${device}.png`), animations: "disabled", fullPage: false });
    state.failure = true;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.siteContentStatus === "fallback");
    await assertAbout(page);
    state.failure = false;
    for (const [slug, path, hash] of [["john-andrew-balbarosa", "/campus-labs/", ""], ["alpha-romer-coma", "/about/", "#ambassadors"], ["giorgio-armani", "/about/", "#ambassadors"]]) {
      await page.goto(`${origin}/about/${slug}/`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(url => url.pathname === path && url.hash === hash);
    }
    assert.deepEqual(legacyPortraitRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function assertAbout(page) {
  assert.equal(await page.locator('[data-site-content="people"], #team, article.ph-person').count(), 0, "the team directory is removed");
  assert.equal(await page.getByRole("heading", { name: "Our team" }).count(), 0);
  const names = await page.locator(".ph-ambassador h3").allTextContents();
  assert.deepEqual(names, ["Alpha Romer Coma", "Giorgio Armani Magno"]);
  assert.equal(await page.locator(".ph-ambassador-photo").count(), 2);
  assert.equal(await page.locator("#campus-labs-leads article.ph-lead").count(), 26);
  // The total across island groups sits above them: every university and every person, once.
  assert.equal((await page.locator("#campus-labs-leads [data-campus-total]").textContent()).replace(/\s+/g, " ").trim(),
    "26 universities and 26 people across Luzon (19), the Visayas (3), and Mindanao (4)");
  // Every portrait loads (lazy images are scrolled into view first).
  for (const selector of [".ph-ambassador-photo", "#campus-labs-leads .ph-lead-photo"]) {
    const images = page.locator(selector);
    for (let index = 0; index < await images.count(); index++) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(element => element.complete && element.naturalWidth > 0, await image.elementHandle());
    }
  }
  // Every Campus Labs card shows exactly one portrait, the file named for the person on that card.
  const cards = await page.locator("#campus-labs-leads article.ph-lead").evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector(".ph-lead-name")?.textContent.trim(),
    // The displayed image (currentSrc) counts, and no srcset or <picture> may choose another file.
    photos: [...node.querySelectorAll(".ph-lead-badge .ph-lead-photo")].map(image => new URL(image.currentSrc || image.src).pathname),
    alternates: node.querySelectorAll(".ph-lead-badge img[srcset], .ph-lead-badge picture, .ph-lead-badge source").length,
  })));
  const slug = name => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  assert.equal(new Set(cards.map(card => card.name)).size, 26, "26 distinct people");
  for (const card of cards) {
    assert.deepEqual(card.photos, [`/assets/images/campus-labs/${slug(card.name)}.jpg`], `portrait for ${card.name}`);
    assert.equal(card.alternates, 0, `portrait for ${card.name} has no srcset or picture alternates`);
  }
  assert.equal(await page.locator("h1").count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}

async function expectRevision(page, revision) {
  await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), revision);
}

async function mockPublishedRequests(context, origin, state, legacyPortraitRequests) {
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) return route.abort();
    if (/\/assets\/images\/maintainers\//.test(url.pathname)) legacyPortraitRequests.push(url.pathname);
    if (url.origin === API_ORIGIN && url.pathname === "/public/site-content") {
      assert.equal(request.headers().cookie, undefined);
      return route.fulfill({ status: state.failure ? 503 : 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ revision: state.revision, document: publishedDocument(state.rows), officialPytorchNews: [] }) });
    }
    if (url.origin === API_ORIGIN && /^\/public\/organization-photos\/[a-f0-9]{64}$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: PHOTO_SVG });
    }
    if (url.pathname === "/assets/site-content-defaults.json" && [origin, "https://pytorch.ph"].includes(url.origin)) {
      const stale = publishedDocument([{ id: "legacy-alpha", name: "Alpha Romer Coma", title: "Unpublished static role", photoUrl: "https://pytorch.ph/assets/images/maintainers/legacy-alpha.jpg" }]);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stale) });
    }
    if (url.origin === "https://pytorch.ph") {
      const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    return url.origin === origin ? route.continue() : route.abort();
  });
}

await main();
