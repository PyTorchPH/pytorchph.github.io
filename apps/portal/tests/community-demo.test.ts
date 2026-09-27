import assert from "node:assert/strict";
import test from "node:test";
import { communityDemoView } from "../app/dashboard/community/demo-model";

test("community preview starts with seven public channels and no staff channels", () => {
  const newcomer = communityDemoView("newcomer", ["interest-mentor"]);
  assert.equal(newcomer.availableChannels.length, 7);
  assert.ok(newcomer.availableChannels.every((channel) => channel.defaultChannel));
  assert.ok(!new Set<string>(newcomer.availableChannels.map((channel) => channel.key)).has("mod-ops"));
  assert.equal(newcomer.eventBands.filter((event) => event.unlocked).length, 0);
});

test("interests suggest channels but do not unlock them", () => {
  const beginner = communityDemoView("beginner", ["interest-mentor"]);
  assert.ok(beginner.recommendedKeys.has("mentor-circle"));
  assert.ok(beginner.lockedChannels.some((channel) => channel.key === "mentor-circle"));
  assert.ok(beginner.availableChannels.some((channel) => channel.key === "beginner-lab"));
});

test("verified credentials unlock the mentor path even with few points", () => {
  const mentor = communityDemoView("mentor", []);
  assert.equal(mentor.profile.accessBand, "mentor");
  assert.ok(mentor.availableChannels.some((channel) => channel.key === "mentor-circle"));
  assert.ok(mentor.eventBands.every((event) => event.unlocked));
});
