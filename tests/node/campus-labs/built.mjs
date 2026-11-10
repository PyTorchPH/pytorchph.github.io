// Checks the Campus Labs cards in the built Jekyll site (frontend/public-site/_site), so the Liquid
// that builds them is tested with Jekyll itself. Run after a build: npm run test:campus:built
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const decode = value => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Mirrors _includes/ph/campus_chapter_list.html: first letter of the first word and, when there is
// more than one word, of the last word, upper-cased.
const initials = name => { const words = name.trim().split(/\s+/).filter(Boolean); return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase(); };

let checked = 0;
for (const page of ["campus-labs/index.html", "about/index.html"]) {
  const file = resolve(root, "frontend/public-site/_site", page);
  assert.ok(existsSync(file), `Build the public site before running this check (${page} missing)`);
  const html = readFileSync(file, "utf8");
  const cards = [...html.matchAll(/<article class="ph-lead"[^>]*>\s*<span class="ph-lead-badge" aria-hidden="true">([^<]*)<\/span>\s*<div class="ph-lead-body">\s*<h4 class="ph-lead-name">([^<]*)<\/h4>/g)];
  assert.ok(cards.length > 0, `${page}: no lead cards found`);
  for (const [, badge, name] of cards) {
    assert.equal(decode(badge), initials(decode(name)), `${page}: badge for ${decode(name)}`);
    checked++;
  }
  // Every card carries the attributes the renderer uses to merge published chapters.
  for (const [card] of html.matchAll(/<article class="ph-lead[^"]*"[^>]*>/g)) {
    if (card.includes("ph-lead-invite")) continue;
    assert.match(card, /data-static-chapter="[^"]+"/, `${page}: card without data-static-chapter`);
    assert.match(card, /data-island="(Luzon|Visayas|Mindanao)"/, `${page}: card without a valid island`);
  }
}
console.log(JSON.stringify({ event: "campus_labs.built.verified", outcome: "success", cards: checked }));
