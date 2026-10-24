const GROUP_LABELS = { ambassador: "Ambassadors", core: "Core team", department: "Departments" };

// Mental model: current assignments identify people; combine their roles, never their names.
export function collectPeople(rows) {
  const people = new Map();
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!row || typeof row !== "object" || !text(row.name)) continue;
    const key = personKey(row, index);
    const person = people.get(key) ?? newPerson(key, row);
    addAssignment(person, row);
    people.set(key, person);
  }
  return [...people.values()];
}

function personKey(row, index) {
  const id = text(row.id);
  const token = /^[a-z0-9_-]+-([a-f0-9]{64})$/.exec(id)?.[1];
  return token ? `member:${token}` : id ? `record:${id}` : `anonymous:${index}`;
}

function newPerson(key, row) {
  return {
    key, name: text(row.name), roles: [], groups: [], departments: [], affiliations: [],
    photoUrl: text(row.photoUrl) || null, photoWithheld: !text(row.photoUrl),
  };
}

function addAssignment(person, row) {
  appendUnique(person.roles, row.title);
  appendUnique(person.groups, GROUP_LABELS[row.group]);
  appendUnique(person.departments, row.department);
  appendUnique(person.affiliations, row.affiliation);
  // Every role uses the same identity-owned visibility. A withheld portrait wins over stale rows.
  person.photoWithheld ||= !text(row.photoUrl);
  person.photoUrl = person.photoWithheld ? null : person.photoUrl;
}

function appendUnique(values, value) {
  const label = text(value);
  if (label && !values.includes(label)) values.push(label);
}

export function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
