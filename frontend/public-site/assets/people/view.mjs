import { collectPeople } from "./model.mjs";
import { readDetails } from "./metadata.mjs";

const renderedContent = new WeakMap();

// Mental model: one published identity -> one portrait and heading -> all its roles and biography.
export function renderPeople(targets, rows, { api, scope = document }) {
  if (!targets.length) return;
  const people = collectPeople(rows);
  const details = readDetails(scope, people);
  const snapshot = JSON.stringify(people.map(person => [person, details.get(person.key)]));
  for (const target of targets) {
    // Retain keyboard focus and loaded portraits when the published directory has not changed.
    if (renderedContent.get(target) === snapshot) continue;
    const owner = target.ownerDocument;
    target.replaceChildren(...people.map(person => profile(owner, person, details.get(person.key), api)));
    if (!people.length) {
      target.append(element(owner, "p", "Published team profiles will appear here.", "ph-empty"));
    }
    renderedContent.set(target, snapshot);
  }
}

function profile(owner, person, details, api) {
  const article = element(owner, "article", null, "ph-person");
  article.dataset.personKey = person.key;
  const heading = element(owner, "header", null, "ph-person-heading");
  const intro = element(owner, "div", null, "ph-person-intro");
  if (person.groups.length) intro.append(element(owner, "p", person.groups.join(" · "), "ph-person-eyebrow"));
  intro.append(element(owner, "h3", person.name, "ph-person-name"));
  if (person.roles.length) intro.append(roleList(owner, person.roles));
  const metadata = [...person.affiliations, ...person.departments.map(value => `${value} department`)];
  if (metadata.length) intro.append(element(owner, "p", metadata.join(" · "), "ph-person-meta"));
  heading.append(portrait(owner, person, api), intro);
  article.append(heading);
  const body = biography(owner, details);
  if (body) article.append(body);
  return article;
}

function portrait(owner, person, api) {
  const wrapper = element(owner, "div", null, "ph-person-portrait");
  const placeholder = element(owner, "span", initials(person.name), "ph-person-placeholder");
  placeholder.setAttribute("aria-hidden", "true");
  const source = safeUrl(person.photoUrl, api);
  if (!source) {
    wrapper.append(placeholder);
    return wrapper;
  }
  const image = element(owner, "img", null, "ph-person-photo");
  image.src = source;
  image.alt = person.name;
  image.width = 160;
  image.height = 160;
  image.loading = "lazy";
  image.addEventListener("error", () => wrapper.replaceChildren(placeholder), { once: true });
  wrapper.append(image);
  return wrapper;
}

function roleList(owner, roles) {
  const list = element(owner, "ul", null, "ph-person-roles");
  for (const role of roles) list.append(element(owner, "li", role));
  return list;
}

function biography(owner, details) {
  if (!details) return null;
  const body = element(owner, "div", null, "ph-person-body");
  if (details.bio) body.append(element(owner, "p", details.bio, "ph-person-bio"));
  const links = element(owner, "ul", null, "ph-person-links");
  for (const item of details.links) {
    const url = safeUrl(item.url);
    if (!url || !item.label) continue;
    const link = element(owner, "a", item.label);
    link.href = url;
    link.rel = "noopener noreferrer";
    const row = element(owner, "li");
    row.append(link);
    links.append(row);
  }
  if (links.childElementCount) body.append(links);
  return body.childElementCount ? body : null;
}

function safeUrl(value, api) {
  if (typeof value !== "string" || !value) return null;
  try {
    const relativePhoto = /^\/public\/organization-photos\/[a-f0-9]{64}$/.test(value);
    const url = new URL(value, relativePhoto ? api : undefined);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join("").toLocaleUpperCase("en-PH");
}

function element(owner, tag, value, className) {
  const node = owner.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}
