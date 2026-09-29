import { strict as assert } from "node:assert";
import { test } from "node:test";

import { computeCgpa, evaluateHonors, sortTermLabels } from "./logic";

test("computes weighted CGPA", () => {
  const result = computeCgpa([
    { termLabel: "1 - 20252026", courseCode: "A", courseTitle: "A", units: 3, finalGrade: 4 },
    { termLabel: "1 - 20252026", courseCode: "B", courseTitle: "B", units: 1, finalGrade: 2 }
  ]);
  assert.equal(result.cgpa, 3.5);
  assert.equal(result.completedUnits, 4);
});

test("sorts FEU term labels", () => {
  assert.deepEqual(sortTermLabels(["2 - 20252026", "1 - 20242025", "1 - 20252026"]), [
    "1 - 20242025", "1 - 20252026", "2 - 20252026"
  ]);
});

test("evaluates current honors standing", () => {
  assert.equal(evaluateHonors(3.65, 100, 160).find((item) => item.qualifiedNow)?.honorName,
    "Magna Cum Laude");
});
