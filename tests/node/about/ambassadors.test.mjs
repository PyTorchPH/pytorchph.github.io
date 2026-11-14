// Drives the built About page (frontend/public-site/_site) in Chromium with the site-content API
// stubbed: the PyTorch Foundation Ambassadors section leads with large portraits, after the
// Foundation's own ambassador directory, and each official biography opens on request.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
const directory = JSON.parse(readFileSync(resolve(site, "../_data/ambassadors_directory.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

async function aboutPage(t, width) {
  assert.ok(existsSync(resolve(site, "about/index.html")), "Build the public Pages site first");
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
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === "https://api.pytorch.ph/public/site-content") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 3, revision: 1, document: { leadership: [], chapters: [], articles: [], events: [] }, officialPytorchNews: [] }) });
    }
    return url.startsWith(origin) ? route.continue() : route.abort();
  });
  await page.goto(`${origin}/about/#ambassadors`);
  return { page, errors, section: page.locator("#ambassadors") };
}

test("ambassador cards lead with large portraits, and each biography opens on request", async t => {
  const { page, errors, section } = await aboutPage(t, 1440);
  const people = directory.people;
  assert.deepEqual(await section.locator(".ph-ambassador h3").allTextContents(), people.map(person => person.name));
  const photos = section.locator(".ph-ambassador-photo");
  assert.equal(await photos.count(), people.length);
  for (let index = 0; index < people.length; index++) {
    const box = await photos.nth(index).boundingBox();
    assert.ok(box.width >= 280 && Math.abs(box.width - box.height) < 2, `portrait ${index + 1} is a large square (${box.width} × ${box.height})`);
  }

  for (const person of people) {
    const card = section.locator(`#ambassador-${person.id}`);
    // Profile links name the person for screen readers.
    if (person.github) assert.equal(await card.getByRole("link", { name: `GitHub profile of ${person.name}` }).getAttribute("href"), person.github);
    if (person.linkedin) assert.equal(await card.getByRole("link", { name: `LinkedIn profile of ${person.name}` }).getAttribute("href"), person.linkedin);
    // The biography is not on the card; its button opens it, and Escape returns to the button.
    const firstWords = person.bio[0].split(" ").slice(0, 6).join(" ");
    const bio = page.getByRole("dialog", { name: person.name });
    assert.equal(await bio.isVisible(), false);
    const open = card.getByRole("button", { name: `Read bio of ${person.name}` });
    await open.click();
    assert.equal(await bio.isVisible(), true);
    assert.equal(await bio.getByText(firstWords).isVisible(), true);
    for (const paragraph of person.bio) assert.equal(await bio.getByText(paragraph, { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "Close");
    await page.keyboard.press("Escape");
    assert.equal(await bio.isVisible(), false);
    assert.equal(await open.evaluate(button => button === document.activeElement), true);
  }
  assert.deepEqual(errors, []);
});

test("the closed biography panels do not take focus when the page opens", async t => {
  const { page, errors } = await aboutPage(t, 1440);
  await page.waitForLoadState("load");
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  assert.deepEqual(errors, []);
});

test("in a browser without popovers each biography shows in its card instead", async t => {
  const { page, errors, section } = await aboutPage(t, 1440);
  // Render the page as a browser without the Popover API would (before Chromium 114, Firefox 125,
  // Safari 17): the rules it would skip (@supports selector(:popover-open)) are removed, and the
  // panels lose the popover behavior that hides them.
  const removed = await page.evaluate(() => {
    let count = 0;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let index = rules.length - 1; index >= 0; index--) {
        if (rules[index] instanceof CSSSupportsRule && rules[index].conditionText.includes(":popover-open")) { sheet.deleteRule(index); count++; }
      }
    }
    document.querySelectorAll(".ph-bio[popover]").forEach(node => node.removeAttribute("popover"));
    return count;
  });
  assert.ok(removed > 0, "the panel styles sit behind @supports selector(:popover-open)");
  for (const person of directory.people) {
    const card = section.locator(`#ambassador-${person.id}`);
    const cardBox = await card.boundingBox();
    const bio = card.locator(".ph-bio");
    const bioBox = await bio.boundingBox();
    assert.ok(bioBox && bioBox.x >= cardBox.x - 1 && bioBox.x + bioBox.width <= cardBox.x + cardBox.width + 1, `${person.name}: the biography stays inside the card`);
    assert.equal(await bio.getByText(person.bio[0], { exact: true }).isVisible(), true);
    // Controls that would do nothing are not shown.
    assert.equal(await card.getByRole("button").count(), 0, `${person.name}: no inoperative buttons`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test("on a phone the portraits stay large and nothing scrolls sideways", async t => {
  const { page, errors, section } = await aboutPage(t, 390);
  const box = await section.locator(".ph-ambassador-photo").first().boundingBox();
  assert.ok(box.width >= 300, `portrait is ${box.width}px wide`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

// The top of the About page: the mission as a large statement, the six principles as a row of words,
// three short reasons, and three goals on a dark band, instead of six equal boxes of text.
test("the About page opens with the mission, large, then the principles, three reasons, and three goals", async t => {
  const { page, errors } = await aboutPage(t, 1440);
  await page.evaluate(() => window.scrollTo(0, 0));
  const identity = readFileSync(resolve(site, "../_data/community_identity.yml"), "utf8");
  const mission = page.locator(".ph-mission-statement");
  assert.match((await mission.textContent()).replace(/\s+/g, " ").trim(), /^Make practical machine learning education and collaboration more accessible throughout the Philippines\.$/);
  assert.ok(await mission.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 30, "the mission is large");
  // The principles: six words in one row.
  const values = page.locator(".ph-values li");
  assert.deepEqual(await values.allTextContents(), ["Openness", "Integrity", "Inclusion", "Collaboration", "Continuous Learning", "Responsible Innovation"]);
  assert.equal(new Set(await values.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)))).size, 1);
  // Three reasons, each a heading and a couple of short sentences, side by side.
  const reasons = page.locator(".ph-reasons > article");
  assert.equal(await reasons.count(), 3);
  for (const text of await reasons.locator("p").allTextContents()) assert.ok(text.trim().length <= 190, `"${text.trim()}" is ${text.trim().length} characters`);
  assert.equal(new Set(await reasons.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)))).size, 1);
  // Three goals on a dark band.
  const goals = page.locator(".ph-goals li");
  assert.equal(await goals.count(), 3);
  assert.equal(await page.locator(".ph-goals").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(38, 38, 38)");
  // No grid of boxes, no repeated page title, and no text under 16px.
  assert.equal(await page.locator("main > section").first().locator(".ph-about-item").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "About PyTorch Philippines" }).evaluate(node => getComputedStyle(node).position), "absolute", "the section's name is for screen readers; the hero already says About us");
  const smallest = await page.evaluate(() => {
    let min = 99;
    for (const section of document.querySelectorAll(".ph-about-intro, .ph-goals")) {
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const parent = walker.currentNode.parentElement; if (!walker.currentNode.textContent.trim() || parent.closest(".ph-visually-hidden")) continue; min = Math.min(min, parseFloat(getComputedStyle(parent).fontSize)); }
    }
    return min;
  });
  assert.ok(smallest >= 16, `smallest text ${smallest}px`);
  assert.ok(identity.includes("reasons:") && identity.includes("goals:"));
  assert.deepEqual(errors, []);
});

test("on a phone the About opening stacks and nothing scrolls sideways", async t => {
  const { page, errors } = await aboutPage(t, 390);
  assert.equal(await page.locator(".ph-reasons > article").count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

// The Filipino phrase above each page title is in PyTorch orange (not a muted tint), large enough to
// count as large text, on a hero dark enough to keep 3:1 or more behind it (WCAG 2.2, 1.4.3).
test("the phrase above each page title is PyTorch orange and readable", async t => {
  const { page, errors } = await aboutPage(t, 1440);
  const origin = new URL(page.url()).origin;
  const linear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = ([r, g, b]) => 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
  for (const [width, paths] of [[1440, ["/about/", "/news/", "/learn/", "/campus-labs/", "/code-of-conduct/"]], [390, ["/about/", "/campus-labs/"]]]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(`${origin}${path}`);
      const kicker = page.locator(".ph-hero .ph-hero-kicker");
      // Read from the phrase's own element, which is what is drawn.
      const style = await kicker.evaluate(node => { const s = getComputedStyle(node.querySelector("span") ?? node); return { color: s.color, size: parseFloat(s.fontSize), weight: Number(s.fontWeight) }; });
      assert.equal(style.color, "rgb(238, 76, 44)", `${path} at ${width}`);
      assert.ok(style.size >= 24 || (style.size >= 18.66 && style.weight >= 700), `${path} at ${width}: ${style.size}px at weight ${style.weight} is large text`);
      await page.addStyleTag({ content: ".ph-hero .ph-hero-kicker { color: transparent !important; }" });
      const { data, info } = await sharp(await page.screenshot({ clip: await kicker.boundingBox() })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const backgrounds = [];
      for (let index = 0; index < data.length; index += info.channels) backgrounds.push(luminance([data[index], data[index + 1], data[index + 2]]));
      backgrounds.sort((a, b) => a - b);
      const text = luminance([238, 76, 44]);
      const worst = Math.min(...[backgrounds[Math.floor(backgrounds.length * 0.01)], backgrounds[Math.floor(backgrounds.length * 0.99)]].map(background => (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)));
      assert.ok(worst >= 3, `${path} at ${width}: ${worst.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(errors, []);
});

// A hero says each thing once: the About hero has no paragraph (the page opens with the mission and
// introduction right below), and the Campus Labs hero names Campus Labs and the community once each.
test("page heroes do not repeat what the page says next", async t => {
  const { page, errors } = await aboutPage(t, 1440);
  const origin = new URL(page.url()).origin;
  assert.equal(await page.locator(".ph-hero .lead").count(), 0);
  await page.goto(`${origin}/campus-labs/`);
  const hero = (await page.locator(".ph-hero .ph-hero-content > div").first().textContent()).replace(/\s+/g, " ");
  assert.equal(hero.split("Campus Labs").length - 1, 1, "in the title only");
  assert.equal(hero.split("PyTorch Philippines").length - 1, 1);
  assert.deepEqual(errors, []);
});
