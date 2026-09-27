import type { UserTier } from "../identity/access-rules";
import { rankForPoints } from "../leaderboards/result-shape";

export const discordRankFamilies = ["bronze", "silver", "gold", "platinum", "diamond", "master"] as const;
export type DiscordRankFamily = (typeof discordRankFamilies)[number];

export const discordAccessBands = ["none", "beginner", "builder", "advanced", "mentor"] as const;
export type DiscordAccessBand = (typeof discordAccessBands)[number];

export const discordManagedRoleKeys = [
  "verified-member",
  "active-member",
  "leaderboard-member",
  "access-builder",
  "access-advanced",
  "access-mentor",
  ...discordRankFamilies.map((family) => `rank-${family}` as const),
] as const;
export type DiscordManagedRoleKey = (typeof discordManagedRoleKeys)[number];

export type DiscordCommunityMemberFacts = {
  linked: boolean;
  sourceFresh: boolean;
  accessRevoked: boolean;
  sanctioned: boolean;
  userTier: UserTier;
  verifiedPoints: number;
  verifiedCredentialSlugs: string[];
};

export type DiscordCommunityAccessDecision = {
  operation: "apply" | "hold" | "revoke";
  reason: "eligible" | "source_stale" | "not_linked" | "access_revoked" | "sanctioned";
  accessBand: DiscordAccessBand;
  rankFamily: DiscordRankFamily | null;
  managedRoleKeys: DiscordManagedRoleKey[];
};

const accessThresholds = {
  builder: { points: 750, credentials: 1 },
  advanced: { points: 2_250, credentials: 3 },
  mentor: { points: 3_000, credentials: 5 },
} as const;

function verifiedCredentialCount(slugs: string[]) {
  return new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)).size;
}

function assertVerifiedPoints(points: number) {
  if (!Number.isSafeInteger(points) || points < 0) throw new Error("Verified points must be a non-negative safe integer.");
}

export function discordRankFamilyForPoints(verifiedPoints: number): DiscordRankFamily {
  assertVerifiedPoints(verifiedPoints);
  return rankForPoints(verifiedPoints).tier.toLowerCase() as DiscordRankFamily;
}

export function discordAccessBandForFacts(facts: Pick<DiscordCommunityMemberFacts, "verifiedPoints" | "verifiedCredentialSlugs">): Exclude<DiscordAccessBand, "none"> {
  assertVerifiedPoints(facts.verifiedPoints);
  const credentials = verifiedCredentialCount(facts.verifiedCredentialSlugs);
  if (facts.verifiedPoints >= accessThresholds.mentor.points || credentials >= accessThresholds.mentor.credentials) return "mentor";
  if (facts.verifiedPoints >= accessThresholds.advanced.points || credentials >= accessThresholds.advanced.credentials) return "advanced";
  if (facts.verifiedPoints >= accessThresholds.builder.points || credentials >= accessThresholds.builder.credentials) return "builder";
  return "beginner";
}

export function deriveDiscordCommunityAccess(facts: DiscordCommunityMemberFacts): DiscordCommunityAccessDecision {
  assertVerifiedPoints(facts.verifiedPoints);
  if (!facts.sourceFresh) return { operation: "hold", reason: "source_stale", accessBand: "none", rankFamily: null, managedRoleKeys: [] };
  if (!facts.linked) return { operation: "revoke", reason: "not_linked", accessBand: "none", rankFamily: null, managedRoleKeys: [] };
  if (facts.accessRevoked) return { operation: "revoke", reason: "access_revoked", accessBand: "none", rankFamily: null, managedRoleKeys: [] };
  if (facts.sanctioned) return { operation: "revoke", reason: "sanctioned", accessBand: "none", rankFamily: null, managedRoleKeys: [] };

  const rankFamily = discordRankFamilyForPoints(facts.verifiedPoints);
  const accessBand = discordAccessBandForFacts(facts);
  const roles = new Set<DiscordManagedRoleKey>(["verified-member", `rank-${rankFamily}`]);
  if (["active", "leaderboard", "admin"].includes(facts.userTier)) roles.add("active-member");
  if (["leaderboard", "admin"].includes(facts.userTier)) roles.add("leaderboard-member");
  if (["builder", "advanced", "mentor"].includes(accessBand)) roles.add("access-builder");
  if (["advanced", "mentor"].includes(accessBand)) roles.add("access-advanced");
  if (accessBand === "mentor") roles.add("access-mentor");

  return { operation: "apply", reason: "eligible", accessBand, rankFamily, managedRoleKeys: [...roles] };
}
