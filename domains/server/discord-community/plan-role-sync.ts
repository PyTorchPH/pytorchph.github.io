import {
  deriveDiscordCommunityAccess,
  discordCommunityBlueprint,
  discordManagedRoleKeys,
  type DiscordCommunityMemberFacts,
  type DiscordManagedRoleKey,
} from "@pytorch-ph/domain-protocol/discord-community";

export type DiscordRoleSyncPlan = {
  outcome: "apply" | "hold" | "revoke";
  reason: string;
  add: DiscordManagedRoleKey[];
  remove: DiscordManagedRoleKey[];
  keep: DiscordManagedRoleKey[];
  untouchedRoleKeys: string[];
  event: {
    code: "discord.role_sync.planned" | "discord.role_sync.held";
    outcome: 0 | 1;
    attributes: { addCount: number; removeCount: number; keepCount: number; reason: string };
  };
};

const managedRoleKeys = new Set<string>(discordManagedRoleKeys);
const websiteBlueprintRoles = new Set(
  discordCommunityBlueprint.roles.filter((role) => role.authority === "website").map((role) => role.key),
);

if (managedRoleKeys.size !== websiteBlueprintRoles.size || [...managedRoleKeys].some((key) => !websiteBlueprintRoles.has(key))) {
  throw new Error("Discord managed-role policy and server blueprint are inconsistent.");
}

export function planDiscordRoleSync(facts: DiscordCommunityMemberFacts, currentRoleKeys: string[]): DiscordRoleSyncPlan {
  const decision = deriveDiscordCommunityAccess(facts);
  const currentManaged = new Set(currentRoleKeys.filter((key) => managedRoleKeys.has(key)) as DiscordManagedRoleKey[]);
  const untouchedRoleKeys = currentRoleKeys.filter((key) => !managedRoleKeys.has(key));

  if (decision.operation === "hold") {
    const keep = [...currentManaged];
    return {
      outcome: "hold",
      reason: decision.reason,
      add: [],
      remove: [],
      keep,
      untouchedRoleKeys,
      event: { code: "discord.role_sync.held", outcome: 0, attributes: { addCount: 0, removeCount: 0, keepCount: keep.length, reason: decision.reason } },
    };
  }

  const desired = new Set(decision.managedRoleKeys);
  const add = [...desired].filter((key) => !currentManaged.has(key));
  const remove = [...currentManaged].filter((key) => !desired.has(key));
  const keep = [...currentManaged].filter((key) => desired.has(key));
  return {
    outcome: decision.operation,
    reason: decision.reason,
    add,
    remove,
    keep,
    untouchedRoleKeys,
    event: { code: "discord.role_sync.planned", outcome: 1, attributes: { addCount: add.length, removeCount: remove.length, keepCount: keep.length, reason: decision.reason } },
  };
}
