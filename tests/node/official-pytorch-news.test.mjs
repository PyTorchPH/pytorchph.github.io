import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Runs the production renderer against an isolated copy of the API's PyTorch blog feed; never the live API.
// The pytorch.org feed writes punctuation as numeric character references ("kernel&#8217;s"). The API
// decodes named references (&amp;, &lt;, ...) and tags itself, and passes the numeric ones through.
async function newsPage(t, officialPytorchNews) {
  const source = await readFile(new URL("../../frontend/public-site/assets/site-content.js", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/renderer.js") { response.setHeader("Content-Type", "application/javascript; charset=utf-8"); response.end(source); }
    else if (request.url === "/defaults") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ leadership: [], chapters: [], articles: [], events: [] })); }
    else if (request.url === "/content") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ revision: 1, document: { leadership: [], chapters: [], articles: [], events: [] }, officialPytorchNews })); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><meta charset="utf-8"><body><div data-site-content="pytorch-news" data-limit="3"></div><script src="/renderer.js" data-api="/content" data-defaults="/defaults"></script></body>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ timezoneId: "Asia/Manila" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.documentElement.dataset.siteContentRevision === "1");
  return { page, errors, news: page.locator('[data-site-content="pytorch-news"]') };
}

test("PyTorch blog posts show punctuation, not the feed's character codes", async t => {
  const { errors, news } = await newsPage(t, [{
    title: "PyTorch&#8217;s &#x201C;fast&#x201d; path",
    url: "https://pytorch.org/blog/example/",
    publishedAt: "2026-11-12T16:45:26+00:00",
    categories: ["R&D&#8217;s"],
    excerpt: "Helion reads a kernel&#8217;s IR &#8211; fast & small&#8230; The post PyTorch&#8217;s &#8220;fast&#8221; path appeared first on PyTorch.",
  }]);
  assert.equal(await news.locator("h3").textContent(), "PyTorch\u2019s \u201cfast\u201d path");
  assert.equal(await news.locator(".ph-card-meta").textContent(), "November 13, 2026 · R&D\u2019s");
  assert.equal(await news.locator("p:not(.ph-card-meta)").textContent(), "Helion reads a kernel\u2019s IR \u2013 fast & small\u2026");
  assert.deepEqual(errors, []);
});

test("feed text is decoded once and stays text", async t => {
  const { errors, news } = await newsPage(t, [{
    // The API turned the feed's "&amp;amp;" into "&amp;": that is the post's own text and stays as written.
    title: "Write &amp; as &#60;img src=x onerror=alert(1)&#62;",
    url: "https://pytorch.org/blog/example/",
    publishedAt: "2026-11-12T16:45:26+00:00",
    categories: [],
    excerpt: "Out of range &#99999999; &#x110000; &#0; and lone surrogates &#xD800; &#57343; stay.",
  }]);
  assert.equal(await news.locator("h3").textContent(), "Write &amp; as <img src=x onerror=alert(1)>");
  assert.equal(await news.locator("img").count(), 0);
  assert.equal(await news.locator("p:not(.ph-card-meta)").textContent(), "Out of range &#99999999; &#x110000; &#0; and lone surrogates &#xD800; &#57343; stay.");
  assert.deepEqual(errors, []);
});
