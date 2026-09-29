export type UserTier = "admin" | "leaderboard" | "active" | "general";

export const userTiers: Record<UserTier, { label: string; description: string }> = {
  admin: {
    label: "Execs & Officers",
    description: "Full prototype visibility for analytics, events, approvals, and operations."
  },
  leaderboard: {
    label: "Leaderboard Member",
    description: "Elite member visibility with priority event enrollment."
  },
  active: {
    label: "Active Member",
    description: "Personal growth, awards, radar charts, and early event access."
  },
  general: {
    label: "General Member",
    description: "Entry state with locked analytics until one event participation."
  }
};

export function canSeeAdmin(tier: UserTier) {
  return tier === "admin";
}

export function hasPriorityEnrollment(tier: UserTier) {
  return tier === "leaderboard" || tier === "admin";
}

export function hasAdvancedAnalytics(tier: UserTier) {
  return tier === "active" || tier === "leaderboard" || tier === "admin";
}
