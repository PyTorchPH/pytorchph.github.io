import assert from "node:assert/strict";
import test from "node:test";
import { matchesKeywords, narrowFromSnapshot, refines, searchKeywords } from "../../features/member-profile/search-refinement";

type Row = { label: string };
const words = (row: Row) => row.label;
const complete = (query: string, labels: string[]) => ({ query, items: labels.map((label) => ({ label })), complete: true });

test("keywords split on spaces and punctuation, lowercase, without accents", () => {
  assert.deepEqual(searchKeywords("STI College-Lucena  Dasmariñas"), ["sti", "college", "lucena", "dasmarinas"]);
});

test("every keyword must prefix some word, in any order (the server's rule)", () => {
  const record = searchKeywords("STI College - Lucena STI Lucena City Quezon");
  assert.equal(matchesKeywords(record, searchKeywords("college lucena sti")), true);
  assert.equal(matchesKeywords(record, searchKeywords("colle luc")), true);
  assert.equal(matchesKeywords(record, searchKeywords("calamba sti")), false);
});

test("adding or extending words refines; changing earlier words does not", () => {
  assert.equal(refines("colle", "college"), true);
  assert.equal(refines("college", "college sti"), true);
  assert.equal(refines("college sti", "college"), false);
  assert.equal(refines("sti", "college sti"), false);
  assert.equal(refines("", "sti"), false);
});

test("a complete answer is narrowed locally; a truncated one is not", () => {
  const snapshot = complete("college", ["STI College - Lucena", "Sacred Heart College - Lucena", "AMA Computer College - Calamba"]);
  assert.deepEqual(narrowFromSnapshot(snapshot, "college sti", words)?.map((row) => row.label), ["STI College - Lucena"]);
  assert.deepEqual(narrowFromSnapshot(snapshot, "college luc", words)?.length, 2);
  assert.equal(narrowFromSnapshot({ ...snapshot, complete: false }, "college sti", words), null);
  assert.equal(narrowFromSnapshot(snapshot, "university", words), null);
});
