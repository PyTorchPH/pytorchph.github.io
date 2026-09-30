import assert from "node:assert/strict";
import test from "node:test";
import { defaultTagOwner, parseComposed } from "../../features/organization/collab-mail/compose";

const positions = [{ slug: "coo", title: "COO" }, { slug: "treasurer", title: "Treasurer" }, { slug: "head_partnerships_outreach", title: "Outreach" }];

test("facts go to their default owners", () => {
  assert.equal(defaultTagOwner("date", "treasurer"), "coo");
  assert.equal(defaultTagOwner("budget", "coo"), "treasurer");
  assert.equal(defaultTagOwner("other", "treasurer"), "treasurer");
});

test("the AI split is checked: unknown owners fall back, tags must be in the text", () => {
  const reply = JSON.stringify({ subject: "PyTorch Day", sections: [
    { content: "Join us on October 20.", ownerPosition: "made_up", tags: [{ label: "date", phrase: "October 20" }, { label: "venue", phrase: "not in text" }], questions: ["Where?"] },
    { content: "", ownerPosition: "treasurer" },
  ] });
  const composed = parseComposed(reply, positions, "head_partnerships_outreach");
  assert.equal(composed.sections.length, 1);
  assert.equal(composed.sections[0].ownerPosition, "head_partnerships_outreach");
  assert.deepEqual(composed.sections[0].tags, [{ label: "date", phrase: "October 20", ownerPosition: "coo" }]);
  assert.deepEqual(composed.sections[0].questions, ["Where?"]);
  assert.throws(() => parseComposed("nope", positions, "coo"));
});
