import assert from "node:assert/strict";
import test from "node:test";
import { identitySettingsSchema, leaderboardUsernameSchema, leaderboardViewSchema, rankForPoints } from "@pytorch-ph/domain-protocol/leaderboards";

test("all 250-point rank boundaries map from Bronze III through Master I", () => {
  const tiers = ["Bronze","Silver","Gold","Platinum","Diamond","Master"];
  const divisions = ["III","II","I"];
  let ordinal = 0;
  for (const tier of tiers) for (const division of divisions) {
    const boundary = ordinal * 250;
    assert.deepEqual(rankForPoints(boundary), { tier, division, floor: boundary, ceiling: ordinal === 17 ? null : boundary + 250 });
    if (boundary > 0) assert.notDeepEqual(rankForPoints(boundary - 1), rankForPoints(boundary));
    ordinal += 1;
  }
  assert.deepEqual(rankForPoints(100_000), { tier: "Master", division: "I", floor: 4250, ceiling: null });
});

test("leaderboard verification views are explicit and closed to silent broadening", () => {
  for (const view of ["both", "verified", "pending"]) assert.equal(leaderboardViewSchema.safeParse(view).success, true);
  for (const view of ["all", "estimated", "official_only"]) assert.equal(leaderboardViewSchema.safeParse(view).success, false);
});

test("leaderboard identities enforce safe usernames and explicit real-name consent", () => {
  for (const valid of ["abc","Member_01","alex-rivera","A".repeat(24)]) assert.equal(leaderboardUsernameSchema.safeParse(valid).success, true);
  for (const invalid of ["ab","has space","member@example","A".repeat(25)]) assert.equal(leaderboardUsernameSchema.safeParse(invalid).success, false);
  assert.equal(identitySettingsSchema.safeParse({ username: "safe_name", mode: "nickname", realNameConsent: false }).success, true);
  assert.equal(identitySettingsSchema.safeParse({ username: "safe_name", mode: "anonymous", realNameConsent: false }).success, true);
  assert.equal(identitySettingsSchema.safeParse({ username: "safe_name", mode: "real_name", realNameConsent: false }).success, false);
  assert.equal(identitySettingsSchema.safeParse({ username: "safe_name", mode: "real_name", realNameConsent: true }).success, true);
});
