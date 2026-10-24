import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { servePages } from "../../../development/pages-demo/verify/serve-pages.mjs";
import { API_ORIGIN, JOHN_NAME, JOHN_TOKEN, JANE_TOKEN, PHOTO_SVG, publishedDocument, publishedLeadership } from "./fixtures.mjs";

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
  console.log(JSON.stringify({ event: "about.pages.browser_verified", outcome: "success", checks: ["three-published-people", "all-roles", "single-portrait", "withheld-photo", "first-party-biography", "no-static-resurrection", "stable-refresh", "three-legacy-redirects", "single-h1", "no-horizontal-overflow"], artifacts: artifactDirectory }));
}

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
    await assertPeople(page);
    await assertPageStructure(page);
    await page.evaluate(() => document.querySelector("#team").scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: resolve(artifacts, `${device}.png`), animations: "disabled", fullPage: false });
    state.revision++;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expectRevision(page, state.revision);
    await assertPeople(page);
    state.rows = [];
    state.revision++;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expectRevision(page, state.revision);
    assert.equal(await page.locator("article.ph-person").count(), 0);
    assert.equal(await page.locator('[data-site-content="people"] img').count(), 0);
    state.failure = true;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.siteContentStatus === "fallback");
    assert.equal(await page.locator("article.ph-person").count(), 0);
    assert.equal(await page.locator('[data-site-content="people"] img').count(), 0);
    state.failure = false;
    state.rows = publishedLeadership();
    state.revision++;
    for (const slug of ["john-andrew-balbarosa", "alpha-romer-coma", "giorgio-armani"]) {
      await page.goto(`${origin}/about/${slug}/`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(url => url.pathname === "/about/" && url.hash === "#team");
      await expectRevision(page, state.revision);
      await assertPeople(page);
      await assertPageStructure(page);
    }
    assert.deepEqual(legacyPortraitRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function assertPeople(page) {
  assert.equal(await page.locator("article.ph-person").count(), 3);
  const names = await page.locator(".ph-person-name").allTextContents();
  assert.deepEqual(names, [JOHN_NAME, "Jane Rivera", "Kai Santos"]);
  assert.equal(names.includes("Alpha Romer Coma"), false);
  assert.equal(names.includes("Giorgio Armani"), false);
  const john = page.locator(`article.ph-person[data-person-key="member:${JOHN_TOKEN}"]`);
  assert.deepEqual(await john.locator(".ph-person-roles li").allTextContents(), ["Chief Technology Officer", "Campus Labs Lead"]);
  for (const role of ["Core team", "Departments", "Technology department", "Education department", "PyTorch Philippines", "Campus Labs"]) {
    assert.ok((await john.textContent()).includes(role), `Keep published role metadata: ${role}`);
  }
  assert.match(await john.locator(".ph-person-bio").textContent(), /created the community website and member portal/);
  assert.equal(await john.getByRole("link", { name: "GitHub", exact: true }).getAttribute("href"), "https://github.com/JohnAndrewBalbarosa");
  for (const token of [JOHN_TOKEN, JANE_TOKEN]) {
    const portrait = page.locator(`article.ph-person[data-person-key="member:${token}"] img.ph-person-photo`);
    assert.equal(await portrait.count(), 1);
    assert.equal(await portrait.getAttribute("width"), "160");
    assert.equal(await portrait.getAttribute("height"), "160");
    assert.equal(await portrait.getAttribute("src"), `${API_ORIGIN}/public/organization-photos/${token}`);
  }
  const kai = page.locator("article.ph-person").filter({ has: page.getByRole("heading", { name: "Kai Santos", exact: true }) });
  assert.equal(await kai.locator("img").count(), 0);
  assert.equal(await kai.locator(".ph-person-placeholder").count(), 1);
  assert.equal(await page.locator("article.ph-person img").count(), 2);
  assert.match(await page.locator(`article.ph-person[data-person-key="member:${JANE_TOKEN}"]`).textContent(), /Ambassadors/);
}

async function assertPageStructure(page) {
  assert.equal(await page.locator("h1").count(), 1);
  assert.notEqual((await page.locator("h1").textContent()).trim(), JOHN_NAME);
  const linksToJohn = await page.locator("header a, nav a").evaluateAll(links => links.filter(link => {
    try { return new URL(link.href).pathname === "/about/john-andrew-balbarosa/"; } catch { return false; }
  }).length);
  assert.equal(linksToJohn, 0);
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
