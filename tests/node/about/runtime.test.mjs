import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright";
import { peopleModuleSources } from "./assets.mjs";
import { API_ORIGIN, DETAILS_TEMPLATE, JOHN_NAME, JOHN_TOKEN, JANE_TOKEN, PHOTO_SVG, publishedDocument, publishedLeadership } from "./fixtures.mjs";

test("the actual classic bootstrap loads focused modules and renders one safe published profile per identity", async t => {
  const fixture = await rendererFixture(t);
  const { page } = fixture;
  await expectRevision(page, 1);
  assert.equal(await page.locator("article.ph-person").count(), 3);
  const john = person(page, JOHN_TOKEN);
  assert.equal(await john.locator("h3.ph-person-name").textContent(), JOHN_NAME);
  assert.deepEqual(await john.locator(".ph-person-roles li").allTextContents(), ["Chief Technology Officer", "Campus Labs Lead"]);
  assert.match(await john.textContent(), /Technology department/);
  assert.match(await john.textContent(), /Education department/);
  assert.match(await john.textContent(), /PyTorch Philippines/);
  assert.match(await john.textContent(), /Campus Labs/);
  assert.equal(await john.locator("img.ph-person-photo").count(), 1);
  assert.equal(await john.locator("img").getAttribute("width"), "160");
  assert.equal(await john.locator("img").getAttribute("height"), "160");
  assert.match(await john.locator(".ph-person-bio").textContent(), /created the community website and member portal/);
  assert.equal(await john.getByRole("link", { name: "GitHub", exact: true }).getAttribute("href"), "https://github.com/about-fixture");
  assert.equal(await john.locator('a[href^="javascript:"]').count(), 0);
  const kai = page.locator("article.ph-person").filter({ has: page.getByRole("heading", { name: "Kai Santos", exact: true }) });
  assert.equal(await kai.locator("img").count(), 0);
  assert.equal(await kai.locator(".ph-person-placeholder").count(), 1);
  assert.equal(await page.locator("article.ph-person img").count(), 2);
  assert.deepEqual(fixture.legacyPortraitRequests, []);
  assert.deepEqual(fixture.errors, []);
  const focusedLink = await john.getByRole("link", { name: "GitHub", exact: true }).elementHandle();
  await focusedLink.focus();
  fixture.state.revision = 2;
  await refresh(page);
  await expectRevision(page, 2);
  assert.equal(await page.locator("article.ph-person").count(), 3);
  assert.equal(await john.locator("img").count(), 1);
  assert.equal(await focusedLink.evaluate(link => link.isConnected && document.activeElement === link), true,
    "An unchanged published refresh must preserve the focused link node");
});

test("empty leadership and API failure cannot republish inert biographies or stale bundled portraits", async t => {
  const fixture = await rendererFixture(t, { staleBaseline: true });
  await expectRevision(fixture.page, 1);
  fixture.state.rows = [];
  fixture.state.revision = 2;
  await refresh(fixture.page);
  await expectRevision(fixture.page, 2);
  assert.equal(await fixture.page.locator("article.ph-person").count(), 0);
  assert.equal(await fixture.page.locator('[data-site-content="people"] img').count(), 0);
  fixture.state.failure = true;
  await fixture.page.reload();
  await fixture.page.waitForFunction(() => document.documentElement.dataset.siteContentStatus === "fallback");
  assert.equal(await fixture.page.locator("article.ph-person").count(), 0);
  assert.equal(await fixture.page.locator('[data-site-content="people"] img').count(), 0);
  assert.deepEqual(fixture.legacyPortraitRequests, []);
});

test("name-only biographies never enrich two namesakes while an explicit identity key enriches only its owner", async t => {
  const rows = [
    { id: `cto-${JOHN_TOKEN}`, name: "Shared Name", title: "First role", photoUrl: null },
    { id: `ambassador-${JANE_TOKEN}`, name: "Shared Name", title: "Second role", photoUrl: null },
  ];
  const metadata = '<template id="community-people-details"><div data-person-name="Shared Name"><p data-person-bio>Identity-specific biography</p><a data-person-link="GitHub" href="https://github.com/identity-fixture">Source</a></div></template>';
  const fixture = await rendererFixture(t, { rows, metadata });
  await expectRevision(fixture.page, 1);
  assert.equal(await fixture.page.locator("article.ph-person").count(), 2);
  assert.equal(await fixture.page.locator(".ph-person-bio").count(), 0);
  await fixture.page.evaluate(key => {
    document.querySelector("#community-people-details").content.querySelector("[data-person-name]").dataset.personKey = key;
  }, `member:${JOHN_TOKEN}`);
  fixture.state.revision = 2;
  await refresh(fixture.page);
  await expectRevision(fixture.page, 2);
  assert.equal(await person(fixture.page, JOHN_TOKEN).locator(".ph-person-bio").textContent(), "Identity-specific biography");
  assert.equal(await person(fixture.page, JANE_TOKEN).locator(".ph-person-bio").count(), 0);
  assert.equal(await fixture.page.locator(".ph-person-links a").count(), 1);
});

test("published text stays text and invalid portrait schemes never create images", async t => {
  const rows = ["javascript:window.portraitExecuted=true", "data:image/svg+xml,<svg/>", "//untrusted.example/photo.jpg"].map((photoUrl, index) => ({
    id: `record-${index}`, name: `Person ${index}`, title: '<img src=x onerror="window.roleExecuted=true">', group: "core", photoUrl,
  }));
  const fixture = await rendererFixture(t, { rows });
  await expectRevision(fixture.page, 1);
  assert.equal(await fixture.page.locator("article.ph-person").count(), 3);
  assert.equal(await fixture.page.locator("article.ph-person img, article.ph-person script").count(), 0);
  assert.equal(await fixture.page.locator(".ph-person-placeholder").count(), 3);
  assert.match(await fixture.page.locator("article.ph-person").first().textContent(), /<img src=x onerror=/);
  assert.deepEqual(await fixture.page.evaluate(() => [window.portraitExecuted, window.roleExecuted]), [undefined, undefined]);
  assert.deepEqual(fixture.errors, []);
});

function person(page, token) {
  return page.locator(`article.ph-person[data-person-key="member:${token}"]`);
}

async function expectRevision(page, revision) {
  await page.waitForFunction(value => document.documentElement.dataset.siteContentRevision === String(value), revision);
}

async function refresh(page) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

// Mental model: serve actual production JavaScript/modules, mock only published GET responses.
async function rendererFixture(t, { rows = publishedLeadership(), metadata = DETAILS_TEMPLATE, staleBaseline = false } = {}) {
  const renderer = await readFile(new URL("../../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const modules = await peopleModuleSources();
  const state = { rows, revision: 1, failure: false };
  const baseline = publishedDocument(staleBaseline ? [{ id: "legacy-alpha", name: "Alpha Romer Coma", title: "Unpublished static role", photoUrl: "https://pytorch.ph/assets/images/maintainers/legacy-alpha.jpg" }] : []);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/renderer.js" || modules.has(pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(pathname === "/renderer.js" ? renderer : modules.get(pathname));
    } else if (pathname === "/defaults.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(baseline));
    } else if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><html><body><h1>About the community</h1><section id="team" data-site-content="people"></section>${metadata}<script src="/renderer.js" data-api="${API_ORIGIN}/public/site-content" data-defaults="/defaults.json"></script></body></html>`);
    } else {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const legacyPortraitRequests = [];
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
    return url.origin === origin ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  return { state, page, errors, legacyPortraitRequests };
}
