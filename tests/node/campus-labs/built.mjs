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
// more than one word, of the last word, skipping a suffix (Jr., Sr., II, III, IV); upper-cased.
const initials = name => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let last = words.length - 1;
  if (words.length > 2 && /^(jr|sr|ii|iii|iv)$/.test(words[last].toLowerCase().replace(/[.,]/g, ""))) last--;
  return (words[0][0] + (last > 0 ? words[last][0] : "")).toUpperCase();
};

function read(page) {
  const file = resolve(site, page);
  assert.ok(existsSync(file), `${page} is missing: build with \`bundle exec jekyll build --unpublished\` first`);
  return readFileSync(file, "utf8");
}

// Every card, parsed one at a time: any <article> whose class attribute (a real attribute, not
// data-class) contains the token "ph-lead", whatever the attribute or class order. Each card is
// read only up to its own </article>, and every badge on the page must sit inside a recognized
// card or the "start the first one" invite link.
const classList = attributes => (/(?:^|\s)class="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean);
// Elements are recognized by an exact class token, so a renamed class (ph-lead-badge-small)
// does not count.
const withClass = (html, tag, token) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g"))].filter(match => classList(match[1]).includes(token));
const badgesIn = html => withClass(html, "span", "ph-lead-badge");
function cards(html, page) {
  const found = [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
    .filter(article => classList(article[1]).includes("ph-lead"));
  const invites = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter(link => classList(link[1]).includes("ph-lead-invite"));
  for (const invite of invites) {
    const badge = badgesIn(invite[2]);
    assert.equal(badge.length, 1, `${page}: the invite card must have exactly one badge`);
    assert.equal(badge[0][2], "+", `${page}: the invite badge must read "+"`);
  }
  const badgesInside = [...found, ...invites].reduce((total, element) => total + badgesIn(element[2]).length, 0);
  assert.equal(badgesIn(html).length, badgesInside, `${page}: a badge outside a recognized card`);
  const list = found.map((article, index) => {
    const body = article[2];
    const badges = badgesIn(body);
    const names = withClass(body, "h4", "ph-lead-name");
    assert.equal(badges.length, 1, `${page}: card ${index + 1} must have exactly one badge`);
    assert.equal(names.length, 1, `${page}: card ${index + 1} must have exactly one name`);
    return { classes: classList(article[1]).join(" "), attributes: article[1], badge: badges[0][2], name: names[0][2], body };
  });
  return { list, invites: invites.length };
}

function checkCards(page) {
  const html = read(page);
  const { list: all, invites } = cards(html, page);
  assert.ok(all.length > 0, `${page}: no lead cards found`);
  for (const card of all) {
    assert.match(card.attributes, /data-static-chapter="[^"]+"/, `${page}: card without data-static-chapter`);
    assert.match(card.attributes, /data-island="(Luzon|Visayas|Mindanao)"/, `${page}: card without a valid island`);
    if (card.classes.includes("ph-lead-pending")) assert.equal(card.badge, "", `${page}: pending card has a badge`);
    else if (/<img\b/.test(card.badge)) {
      // A portrait: one image, decorative (the name is next to it), pointing at a file that exists.
      const images = [...card.badge.matchAll(/<img\b([^>]*)>/g)];
      assert.equal(images.length, 1, `${page}: badge for ${decode(card.name)} has one image`);
      assert.equal(card.badge.replace(/<img\b[^>]*>/, "").trim(), "", `${page}: badge for ${decode(card.name)} has only the image`);
      const attributes = images[0][1];
      assert.match(attributes, /(?:^|\s)alt=""/, `${page}: portrait of ${decode(card.name)} must have empty alt text`);
      const src = /(?:^|\s)src="([^"]+)"/.exec(attributes)?.[1];
      assert.ok(src && src.startsWith("/assets/images/campus-labs/"), `${page}: portrait of ${decode(card.name)} comes from assets/images/campus-labs`);
      assert.ok(existsSync(resolve(site, decode(src).slice(1))), `${page}: portrait file missing for ${decode(card.name)}: ${src}`);
    }
    else assert.equal(decode(card.badge), initials(decode(card.name)), `${page}: badge for ${decode(card.name)}`);
  }
  return { html, all, invites };
}

// Every person in _data/campus_labs.yml has their own poster portrait, and every rendered card shows
// exactly the portrait named for the person on it: none may fall back to initials or borrow another.
const slug = name => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dataPeople = [...readFileSync(resolve(site, "../_data/campus_labs.yml"), "utf8").matchAll(/^(\s+)- name: (.+)\n\1  photo: (.+)$/gm)];
const dataNames = [...readFileSync(resolve(site, "../_data/campus_labs.yml"), "utf8").matchAll(/^\s+- name: (.+)$/gm)].map(match => match[1].trim());
assert.equal(dataPeople.length, dataNames.length, "every Campus Labs person in the data has a photo right after their name");
for (const [, , name, photo] of dataPeople) assert.equal(photo.trim(), `/assets/images/campus-labs/${slug(name.trim())}.jpg`, `data photo for ${name.trim()}`);
for (const page of ["campus-labs/index.html", "about/index.html"]) {
  const { all } = checkCards(page);
  const names = all.map(card => decode(card.name).trim());
  assert.deepEqual([...names].sort(), [...dataNames].sort(), `${page}: one card per person in the data`);
  for (const card of all) {
    const sources = [...card.badge.matchAll(/(?:^|\s)src="([^"]+)"/g)].map(match => decode(match[1]));
    assert.deepEqual(sources, [`/assets/images/campus-labs/${slug(decode(card.name).trim())}.jpg`], `${page}: portrait for ${decode(card.name)}`);
    assert.ok(!/\ssrcset=|<picture\b|<source\b/.test(card.badge), `${page}: portrait for ${decode(card.name)} has no srcset or picture alternates`);
  }
}
// On the Campus Labs page, every island group with no entry in _data/campus_labs.yml (derived from
// the data, not from the rendered page) has its own group with exactly one invite card.
{
  const data = readFileSync(resolve(site, "../_data/campus_labs.yml"), "utf8");
  const listedIslands = new Set([...data.matchAll(/^\s+island:\s*(Luzon|Visayas|Mindanao)\b/gm)].map(match => match[1]));
  const emptyIslands = ["Luzon", "Visayas", "Mindanao"].filter(island => !listedIslands.has(island));
  const { html, invites } = checkCards("campus-labs/index.html");
  const groups = [...html.matchAll(/<div\b([^>]*)>\s*<h3\b[^>]*>\s*<span>(Luzon|Visayas|Mindanao)<\/span>[\s\S]*?<\/h3>\s*<div class="ph-lead-grid">([\s\S]*?)<\/div>\s*<\/div>/g)]
    .filter(group => classList(group[1]).includes("ph-island"));
  for (const island of emptyIslands) {
    const group = groups.find(candidate => candidate[2] === island && /No Campus Lab yet/.test(candidate[0]));
    assert.ok(group, `campus-labs: ${island} has no Campus Lab in the data but no "No Campus Lab yet" group`);
    const groupInvites = [...group[3].matchAll(/<a\b([^>]*)>/g)].filter(link => classList(link[1]).includes("ph-lead-invite"));
    assert.equal(groupInvites.length, 1, `campus-labs: ${island} must have its own invite card`);
    assert.match(groupInvites[0][1], /(?:^|\s)href="#start"/, `campus-labs: ${island} invite must link to the "Start a Campus Lab" steps`);
  }
  assert.equal(invites, emptyIslands.length, "campus-labs: one invite card per island group without a Campus Lab");
  assert.match(html, /\sid="start"/, 'campus-labs: the invite target #start is missing');
}

// Controlled fixture: one-word, spaced, markup-like, and entity-like names; markup in a
// university and an alias.
const { html, all } = checkCards("test-fixtures/campus-cards/index.html");
const byName = Object.fromEntries(all.map(card => [decode(card.name).trim().replace(/\s+/g, " "), card]));
assert.equal(byName["Ana"].badge, "A", "one-word name gets one initial");
assert.equal(byName["Maria Clara"].badge, "MC", "surrounding and repeated spaces are ignored");
assert.equal(byName["<img src=x onerror=alert(1)>"].badge, "&lt;O", "markup in a name is escaped in the badge");
assert.equal(byName["&amp; Lead"].badge, "&amp;L", "entity-like text stays text");
assert.equal(byName["Jacob John Ferrer Jr."].badge, "JF", "a suffix such as Jr. is skipped");
assert.equal(byName["Juan Dela Cruz III"].badge, "JC", "a numeral suffix is skipped");
assert.ok(!/<img src=x/.test(html), "markup in a name is never output as markup");
assert.ok(!/<b>College<\/b>/.test(html), "markup in a university is never output as markup");
assert.ok(!/" onmouseover="/.test(html), "an alias cannot break out of its attribute");
assert.equal(all.filter(card => card.classes.includes("ph-lead-pending")).length, 1, "a university without leads renders one pending card");
console.log(JSON.stringify({ event: "campus_labs.built.verified", outcome: "success", fixture_cards: all.length }));
