import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPeople } from "../../../frontend/public-site/assets/people/model.mjs";
import { JOHN_NAME, JOHN_TOKEN, JANE_TOKEN, publishedLeadership } from "./fixtures.mjs";

test("one published identity owns one person while retaining every distinct role and affiliation", () => {
  const rows = publishedLeadership();
  rows.push(structuredClone(rows[0]));
  const before = structuredClone(rows);
  const people = collectPeople(rows);
  assert.equal(people.length, 3);
  const john = people.find(person => person.key === `member:${JOHN_TOKEN}`);
  assert.equal(john.name, JOHN_NAME);
  assert.deepEqual(john.roles, ["Chief Technology Officer", "Campus Labs Lead"]);
  assert.deepEqual(john.groups, ["Core team", "Departments"]);
  assert.deepEqual(john.departments, ["Technology", "Education"]);
  assert.deepEqual(john.affiliations, ["PyTorch Philippines", "Campus Labs"]);
  assert.equal(john.photoUrl, `/public/organization-photos/${JOHN_TOKEN}`);
  assert.deepEqual(rows, before, "Grouping must not rewrite published API records");
});

test("equal full names never merge separate member tokens", () => {
  const rows = [
    { id: `cto-${JOHN_TOKEN}`, name: "Shared Name", title: "First role", photoUrl: null },
    { id: `ambassador-${JANE_TOKEN}`, name: "Shared Name", title: "Second role", photoUrl: null },
  ];
  const people = collectPeople(rows);
  assert.equal(people.length, 2);
  assert.deepEqual(people.map(person => person.roles), [["First role"], ["Second role"]]);
  assert.notEqual(people[0].key, people[1].key);
});

test("non-member records group by exact ID and anonymous records retain independent identities", () => {
  const people = collectPeople([
    { id: "legacy-person", name: "Shared Name", title: "Role one", photoUrl: null },
    { id: "legacy-person", name: "Shared Name", title: "Role two", photoUrl: null },
    { id: "different-person", name: "Shared Name", title: "Another person", photoUrl: null },
    { name: "Shared Name", title: "Anonymous one", photoUrl: null },
    { name: "Shared Name", title: "Anonymous two", photoUrl: null },
  ]);
  assert.equal(people.length, 4);
  assert.deepEqual(people[0].roles, ["Role one", "Role two"]);
  assert.equal(people[0].key, "record:legacy-person");
  assert.equal(new Set(people.map(person => person.key)).size, 4);
});

test("explicitly withheld photos defeat other role portraits regardless of ordering", () => {
  for (const withheld of [null, ""]) {
    const visible = { id: `cto-${JOHN_TOKEN}`, name: JOHN_NAME, photoUrl: `/public/organization-photos/${JOHN_TOKEN}` };
    const hidden = { id: `campus_labs_lead-${JOHN_TOKEN}`, name: JOHN_NAME, photoUrl: withheld };
    for (const rows of [[visible, hidden], [hidden, visible]]) {
      assert.equal(collectPeople(rows)[0].photoUrl, null);
    }
  }
});

test("missing published people and invalid rows cannot create placeholder identities", () => {
  for (const rows of [undefined, null, "not rows", [], [null, {}, { name: "  " }]]) {
    assert.deepEqual(collectPeople(rows), []);
  }
});

test("role metadata uses meaningful normalized labels without duplicates", () => {
  const people = collectPeople([
    { id: `cto-${JOHN_TOKEN}`, name: ` ${JOHN_NAME} `, title: " Chief   Technology Officer ", group: "core", department: " Technology ", affiliation: " Community ", photoUrl: null },
    { id: `cto-${JOHN_TOKEN}`, name: JOHN_NAME, title: "Chief Technology Officer", group: "core", department: "Technology", affiliation: "Community", photoUrl: null },
  ]);
  assert.equal(people[0].name, JOHN_NAME);
  assert.deepEqual(people[0].roles, ["Chief Technology Officer"]);
  assert.deepEqual(people[0].departments, ["Technology"]);
  assert.deepEqual(people[0].affiliations, ["Community"]);
});
