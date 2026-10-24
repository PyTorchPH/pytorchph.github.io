import { text } from "./model.mjs";

// Inert first-party biographies enrich a published person; they never publish a person or portrait.
export function readDetails(scope, people) {
  const entries = [...(scope.querySelector("#community-people-details")?.content
    ?.querySelectorAll("[data-person-name]") ?? [])];
  const names = countNames(people.map(person => person.name));
  const entryNames = countNames(entries.map(entry => entry.dataset.personName));
  return new Map(people.map(person => {
    const entry = entries.find(candidate => matchesPerson(candidate, person, names, entryNames));
    return [person.key, entry ? detailsFromEntry(entry) : null];
  }));
}

function countNames(values) {
  const counts = new Map();
  for (const value of values) {
    const name = nameKey(value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function matchesPerson(entry, person, names, entryNames) {
  if (entry.dataset.personKey) return entry.dataset.personKey === person.key;
  const name = nameKey(person.name);
  return names.get(name) === 1 && entryNames.get(name) === 1 && nameKey(entry.dataset.personName) === name;
}

function detailsFromEntry(entry) {
  return {
    bio: text(entry.querySelector("[data-person-bio]")?.textContent),
    links: [...entry.querySelectorAll("[data-person-link]")].map(link => ({
      label: text(link.dataset.personLink || link.textContent), url: link.getAttribute("href"),
    })),
  };
}

function nameKey(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase("en-PH");
}
