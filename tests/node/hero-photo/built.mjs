// Checks the built site (frontend/public-site/_site): every page whose hero shows background photos
// credits each of them in its footer as its license requires (title linked to the source, the
// author or the attribution they ask for, the license linked, and the changes made), every photo
// file exists, and no page credits a photo it does not show.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const site = resolve(import.meta.dirname, "../../../frontend/public-site/_site");
assert.ok(existsSync(resolve(site, "index.html")), "Build the public Pages site first");
const credits = readFileSync(resolve(site, "../_data/photo_credits.yml"), "utf8");
const entry = key => credits.match(new RegExp(`^${key}:\\n((?:  .*\\n?)+)`, "m"))?.[1] ?? "";
const field = (key, name) => entry(key).match(new RegExp(`^  ${name}: "?([^"\\n]+?)"?$`, "m"))?.[1];
const decode = value => value.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const pages = function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.endsWith(".html")) yield path;
  }
};

let checked = 0;
const shown = new Set();
for (const file of pages(site)) {
  const html = readFileSync(file, "utf8");
  const page = relative(site, file);
  const keys = [...html.matchAll(/class="ph-hero-slide[^"]*" data-hero-photo="([a-z0-9_]+)"/g)].map(match => match[1]);
  if (!keys.length) {
    assert.ok(!html.includes("data-photo-credit="), `${page}: credits a photo it does not show`);
    continue;
  }
  assert.equal(new Set(keys).size, keys.length, `${page}: a photo is listed twice`);
  assert.match(html, /class="ph-hero-slide is-active" data-hero-photo=/, `${page}: the first photo is shown without JavaScript`);
  if (keys.length > 1) assert.match(html, /<script src="[^"]*\/assets\/hero-slides\.js" defer><\/script>/, `${page}: crossfade script`);
  const footer = html.slice(html.indexOf("<footer"));
  const changes = field(keys[0], "changes");
  assert.ok(footer.includes(`Header photos from Wikimedia Commons, ${changes}:`) || keys.every(key => footer.includes(`; ${field(key, "changes")})`)), `${page}: the credit says what was changed`);
  for (const key of keys) {
    shown.add(key);
    const want = Object.fromEntries(["title", "author", "author_url", "source_url", "license", "license_url", "changes", "image", "image_portrait", "sha1"].map(name => [name, field(key, name)]));
    for (const [name, value] of Object.entries(want)) assert.ok(value, `${page}: _data/photo_credits.yml has no ${name} for ${key}`);
    const attribution = field(key, "attribution");
    const credit = decode(footer.match(new RegExp(`<span class="ph-photo-credit" data-photo-credit="${key}">([\\s\\S]*?)</span>`))?.[1] ?? "");
    assert.ok(credit, `${page}: shows ${key} but its footer does not credit it`);
    assert.ok(credit.includes(`<a href="${want.source_url}">${want.title}</a>`), `${page}: ${key} credit links the title to the source`);
    assert.ok(credit.includes(`<a href="${want.author_url}">${attribution ?? want.author}</a>`), `${page}: ${key} credit names the author as they ask`);
    assert.ok(credit.includes(`<a href="${want.license_url}">${want.license}</a>`), `${page}: ${key} credit links the license`);
    const slide = html.match(new RegExp(`data-hero-photo="${key}"[^>]*`))[0];
    for (const image of [want.image, want.image_portrait]) {
      assert.ok(slide.includes(image), `${page}: ${key} slide uses ${image}`);
      assert.ok(existsSync(resolve(site, image.slice(1))), `missing ${image}`);
    }
  }
  checked++;
}
assert.ok(checked > 0, "no page shows hero photos: the home page should");
const home = readFileSync(resolve(site, "index.html"), "utf8");
const homeKeys = [...home.matchAll(/data-hero-photo="([a-z0-9_]+)"/g)].map(match => match[1]);
assert.deepEqual(homeKeys, ["manila_post_office", "rizal_monument", "fort_santiago", "manila_bay_sunset"], "the home hero photos, in order");
console.log(JSON.stringify({ event: "hero_photo.built.verified", outcome: "success", pages: checked, photos: [...shown] }));
