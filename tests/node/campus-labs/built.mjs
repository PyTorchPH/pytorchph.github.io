// Checks the Campus Labs cards in the built Jekyll site (frontend/public-site/_site), so the Liquid
// that builds them is tested with Jekyll itself. Build with unpublished pages first, which adds
// the fixture page test-fixtures/campus-cards.html:
//   bundle exec jekyll build --unpublished   (in frontend/public-site)
//   npm run test:campus:built
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
const decode = value => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Mirrors _includes/ph/campus_chapter_list.html: first letter of the first word and, when there is
// more than one word, of the last word, upper-cased.
const initials = name => { const words = name.trim().split(/\s+/).filter(Boolean); return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase(); };

function read(page) {
  const file = resolve(site, page);
  assert.ok(existsSync(file), `${page} is missing: build with \`bundle exec jekyll build --unpublished\` first`);
  return readFileSync(file, "utf8");
}

// Every card, parsed one at a time: no card can be skipped because its markup changed.
function cards(html, page) {
  const starts = [...html.matchAll(/<article class="(ph-lead[^"]*)"([^>]*)>/g)];
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length;
    const body = html.slice(start.index, end);
    const badge = /<span class="ph-lead-badge" aria-hidden="true">([^<]*)<\/span>/.exec(body);
    const name = /<h4 class="ph-lead-name">([^<]*)<\/h4>/.exec(body);
    assert.ok(badge, `${page}: card ${index + 1} has no badge`);
    assert.ok(name, `${page}: card ${index + 1} has no name`);
    return { classes: start[1], attributes: start[2], badge: badge[1], name: name[1], body };
  });
}

function checkCards(page) {
  const html = read(page);
  const all = cards(html, page);
  assert.ok(all.length > 0, `${page}: no lead cards found`);
  for (const card of all) {
    assert.match(card.attributes, /data-static-chapter="[^"]+"/, `${page}: card without data-static-chapter`);
    assert.match(card.attributes, /data-island="(Luzon|Visayas|Mindanao)"/, `${page}: card without a valid island`);
    if (card.classes.includes("ph-lead-pending")) assert.equal(card.badge, "", `${page}: pending card has a badge`);
    else assert.equal(decode(card.badge), initials(decode(card.name)), `${page}: badge for ${decode(card.name)}`);
  }
  return { html, all };
}

for (const page of ["campus-labs/index.html", "about/index.html"]) checkCards(page);

// Controlled fixture: one-word, spaced, markup-like, and entity-like names; markup in a
// university and an alias.
const { html, all } = checkCards("test-fixtures/campus-cards/index.html");
const byName = Object.fromEntries(all.map(card => [decode(card.name).trim().replace(/\s+/g, " "), card]));
assert.equal(byName["Ana"].badge, "A", "one-word name gets one initial");
assert.equal(byName["Maria Clara"].badge, "MC", "surrounding and repeated spaces are ignored");
assert.equal(byName["<img src=x onerror=alert(1)>"].badge, "&lt;O", "markup in a name is escaped in the badge");
assert.equal(byName["&amp; Lead"].badge, "&amp;L", "entity-like text stays text");
assert.ok(!/<img src=x/.test(html), "markup in a name is never output as markup");
assert.ok(!/<b>College<\/b>/.test(html), "markup in a university is never output as markup");
assert.ok(!/" onmouseover="/.test(html), "an alias cannot break out of its attribute");
assert.equal(all.filter(card => card.classes.includes("ph-lead-pending")).length, 1, "a university without leads renders one pending card");
console.log(JSON.stringify({ event: "campus_labs.built.verified", outcome: "success", fixture_cards: all.length }));
