import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveDiscordCommunityAccess,
  discordCommunityBlueprint,
  discordManagedRoleKeys,
  discordRankFamilyForPoints,
  type DiscordCommunityMemberFacts,
} from "@pytorch-ph/domain-protocol/discord-community";
import { planDiscordRoleSync } from "@pytorch-ph/domain-server/discord-community";

const baseFacts: DiscordCommunityMemberFacts = {
  linked: true,
  sourceFresh: true,
  accessRevoked: false,
  sanctioned: false,
  userTier: "general",
  verifiedPoints: 0,
  verifiedCredentialSlugs: [],
};

test("Discord ranks reuse the verified-points tier boundaries", () => {
  assert.equal(discordRankFamilyForPoints(0), "bronze");
  assert.equal(discordRankFamilyForPoints(749), "bronze");
  assert.equal(discordRankFamilyForPoints(750), "silver");
  assert.equal(discordRankFamilyForPoints(2_250), "platinum");
  assert.equal(discordRankFamilyForPoints(3_000), "diamond");
  assert.equal(discordRankFamilyForPoints(3_750), "master");
  assert.throws(() => discordRankFamilyForPoints(-1), /non-negative/);
});

test("website tiers grant only non-privileged community roles", () => {
  const general = deriveDiscordCommunityAccess(baseFacts);
  assert.deepEqual(general.managedRoleKeys.sort(), ["rank-bronze", "verified-member"]);

  const admin = deriveDiscordCommunityAccess({ ...baseFacts, userTier: "admin", verifiedPoints: 3_100 });
  assert.ok(admin.managedRoleKeys.includes("active-member"));
  assert.ok(admin.managedRoleKeys.includes("leaderboard-member"));
  assert.ok(!admin.managedRoleKeys.some((key) => ["administrator", "moderator", "event-host"].includes(key)));
});

test("verified credentials can unlock access without changing the points rank", () => {
  const decision = deriveDiscordCommunityAccess({ ...baseFacts, verifiedCredentialSlugs: ["python", "PYTHON", "pytorch", "computer-vision"] });
  assert.equal(decision.rankFamily, "bronze");
  assert.equal(decision.accessBand, "advanced");
  assert.ok(decision.managedRoleKeys.includes("access-advanced"));
  assert.ok(!decision.managedRoleKeys.includes("access-mentor"));
});

test("stale analytics never add or remove Discord roles", () => {
  const plan = planDiscordRoleSync(
    { ...baseFacts, sourceFresh: false, verifiedPoints: 2_500 },
    ["verified-member", "rank-silver", "moderator", "interest-build"],
  );
  assert.equal(plan.outcome, "hold");
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.untouchedRoleKeys, ["moderator", "interest-build"]);
});

test("explicit revocation removes managed roles and preserves manual roles", () => {
  const plan = planDiscordRoleSync(
    { ...baseFacts, accessRevoked: true },
    ["verified-member", "rank-bronze", "moderator", "event-host"],
  );
  assert.equal(plan.outcome, "revoke");
  assert.deepEqual(plan.remove.sort(), ["rank-bronze", "verified-member"]);
  assert.deepEqual(plan.untouchedRoleKeys, ["moderator", "event-host"]);
});

test("server onboarding stays compact and privilege-safe", () => {
  const defaults = discordCommunityBlueprint.channels.filter((channel) => channel.defaultChannel);
  assert.equal(defaults.length, 7);
  assert.equal(defaults.filter((channel) => channel.writableByEveryone).length, 5);
  assert.ok(discordCommunityBlueprint.channels.filter((channel) => channel.category === "STAFF").every((channel) => channel.requiredRoleKeys.includes("administrator")));
  assert.deepEqual(discordCommunityBlueprint.integrations.thirdPartyBots, []);
  assert.ok(discordCommunityBlueprint.security.removeBootstrapPermissionsAfterProvisioning);

  const websiteRoles = discordCommunityBlueprint.roles.filter((role) => role.authority === "website");
  assert.deepEqual(new Set(websiteRoles.map((role) => role.key)), new Set(discordManagedRoleKeys));
  assert.ok(websiteRoles.every((role) => role.permissions.length === 0));
  assert.ok(discordCommunityBlueprint.onboarding.requiredQuestions.flatMap((question) => question.answers).every((answer) => answer.roleKey.startsWith("interest-")));
});

test("the PyTorch PH blueprint contains no school affiliation", () => {
  const serialized = JSON.stringify(discordCommunityBlueprint);
  assert.doesNotMatch(serialized, /feu|school|student/i);
});
