// Checks the built site (frontend/public-site/_site): every page whose hero shows a background photo
// credits that photo in its footer as its license requires (title linked to the source, author,
// license linked, and the changes made), and the photo files the stylesheet uses exist.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
assert.ok(existsSync(resolve(site, "index.html")), "Build the public Pages site first");
const credits = readFileSync(resolve(site, "../_data/photo_credits.yml"), "utf8");
const field = (key, name) => credits.match(new RegExp(`^${key}:[\\s\\S]*?^  ${name}: "?([^"\\n]+)"?$`, "m"))?.[1];
const pages = function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (entry.endsWith(".html")) yield path;
  }
};

let checked = 0;
for (const file of pages(site)) {
  const html = readFileSync(file, "utf8");
  const backdrop = html.match(/class="ph-hero[^"]*\bph-hero-backdrop-([a-z0-9-]+)/);
  if (!backdrop) continue;
  const key = backdrop[1].replaceAll("-", "_");
  const page = relative(site, file);
  const want = Object.fromEntries(["title", "author", "author_url", "source_url", "license", "license_url", "changes"].map(name => [name, field(key, name)]));
  for (const [name, value] of Object.entries(want)) assert.ok(value, `${page}: _data/photo_credits.yml has no ${name} for ${key}`);
  const credit = html.match(/<li>Header photo:[\s\S]*?<\/li>/)?.[0];
  assert.ok(credit, `${page}: shows the ${key} photo but has no footer credit`);
  assert.ok(credit.includes(`<a href="${want.source_url}">${want.title}</a>`), `${page}: credit links the title to the source`);
  assert.ok(credit.includes(`<a href="${want.author_url}">${want.author}</a>`), `${page}: credit names and links the author`);
  assert.ok(credit.includes(`<a href="${want.license_url}">${want.license}</a>`), `${page}: credit names and links the license`);
  assert.ok(credit.includes(want.changes), `${page}: credit says what was changed`);
  checked++;
}
assert.ok(checked > 0, "no page shows a hero photo: the home page should");
assert.match(readFileSync(resolve(site, "index.html"), "utf8"), /ph-hero-backdrop-manila-post-office/, "the home hero shows the Manila photo");

// Every hero photo the stylesheet uses is in the build.
const css = readFileSync(resolve(site, "assets/main.css"), "utf8");
const photos = [...css.matchAll(/url\("?(\/assets\/images\/manila-[^")]+)"?\)/g)].map(match => match[1]);
assert.ok(photos.length >= 2, "the stylesheet uses the hero photo at two sizes");
for (const photo of photos) assert.ok(existsSync(resolve(site, photo.slice(1))), `missing ${photo}`);
// No other page credits a photo it does not show.
for (const file of pages(site)) {
  const html = readFileSync(file, "utf8");
  if (html.includes("<li>Header photo:")) assert.match(html, /ph-hero-backdrop-/, `${relative(site, file)}: credits a photo it does not show`);
}
console.log(JSON.stringify({ event: "hero_photo.built.verified", outcome: "success", pages: checked, photos }));
