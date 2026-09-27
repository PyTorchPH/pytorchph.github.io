import { configuredProductProvider } from "@pytorch-ph/domain-server/career-evidence";
import { readLocalDemoState, updateLocalDemoState } from "@pytorch-ph/domain-server/career-evidence";
import { createSupabaseServerClient } from "@pytorch-ph/domain-server/identity";
import { identitySettingsSchema, leaderboardUsernameSchema, rankForPoints, type LeaderboardIdentitySettings, type LeaderboardPayload, type LeaderboardView, type MemberOverview } from "@pytorch-ph/domain-protocol/leaderboards";

const people = [
  ["Ari_4D91B", 3890, 7, ["PyTorch","Python","Mentoring","NLP","Research"]],
  ["Alex_Rivera", 3280, 5, ["Python","PyTorch","FastAPI","React","SQL"]],
  ["Mika_7A82F", 2860, 4, ["Computer Vision","PyTorch","Python"]],
  ["Jules_29C10", 2410, 3, ["SQL","Python","Data Engineering"]],
  ["Sam_18B4A", 540, 1, ["Python"]],
] as const;

function demoLeaderboard(userId: string, page: number, pageSize: number, skill?: string | null, view: LeaderboardView = "both"): LeaderboardPayload {
  const identity = readLocalDemoState(userId).leaderboardIdentity;
  const rows = people.map(([displayLabel, verifiedPoints, streak, verifiedSkills], index) => {
    const current = displayLabel === "Alex_Rivera";
    const pendingPoints = current ? 120 : index % 2 === 0 ? 60 : 0;
    const points = view === "verified" ? verifiedPoints : view === "pending" ? pendingPoints : verifiedPoints + pendingPoints;
    const rank = rankForPoints(points);
    const label = current ? identity.mode === "anonymous" ? "Member #7A82F" : identity.mode === "real_name" && identity.realNameConsent ? "Alex Rivera" : identity.username : displayLabel;
    return { rank: index + 1, displayLabel: label, points, verifiedPoints, pendingPoints, streak, verifiedSkills: [...verifiedSkills], isCurrentUser: current, tier: rank.tier, division: rank.division };
  }).filter((row) => row.points > 0 && (!skill || row.verifiedSkills.some((label) => label.toLowerCase().replaceAll(" ", "-") === skill))).sort((left, right) => right.points - left.points || left.displayLabel.localeCompare(right.displayLabel));
  const start = (page - 1) * pageSize;
  return {
    season: { slug: "2026-q3", label: "2026 Quarter 3", state: "active", startsAt: "2026-07-01T00:00:00+08:00", endsAt: "2026-10-01T00:00:00+08:00" }, view,
    entries: rows.slice(start, start + pageSize), page, pageSize, total: rows.length,
    skills: ["Python","PyTorch","FastAPI","React","SQL","Computer Vision","Data Engineering"].map((label) => ({ slug: label.toLowerCase().replaceAll(" ", "-"), label })),
    seasons: [{ slug: "2026-q3", label: "2026 Quarter 3", state: "active" }, { slug: "2026-q2", label: "2026 Quarter 2", state: "completed" }],
    meta: { mode: "local_demo", label: "Synthetic competitive demo" },
  };
}

export async function readLeaderboard(userId: string, query: { season?: string | null; skill?: string | null; view: LeaderboardView; page: number; pageSize: number }): Promise<LeaderboardPayload> {
  if (configuredProductProvider() === "local") return demoLeaderboard(userId, query.page, query.pageSize, query.skill, query.view);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("member_leaderboard", { requested_season: query.season || null, requested_skill: query.skill || null, requested_page: query.page, requested_page_size: query.pageSize, requested_view: query.view });
  if (error || !data) throw new Error(error?.message || "Leaderboard data is unavailable.");
  return { ...(data as unknown as Omit<LeaderboardPayload, "meta">), meta: { mode: "production", label: "Live verified points" } };
}

export async function readMemberOverview(userId: string): Promise<MemberOverview> {
  if (configuredProductProvider() !== "local") {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("member_overview");
    if (error || !data) throw new Error(error?.message || "Member overview is unavailable.");
    return { ...(data as unknown as Omit<MemberOverview, "meta" | "prerequisites">), prerequisites: [], meta: { mode: "production", label: "Live private overview" } };
  }
  const state = readLocalDemoState(userId);
  const board = demoLeaderboard(userId, 1, 25, null, "verified");
  const standing = board.entries.find((entry) => entry.isCurrentUser) || null;
  return {
    summary: { verifiedEvidence: 6, readyResumes: 3, registeredEvents: state.registeredEventIds.length, activeOpportunities: 5, points: standing?.points || 0, rank: standing?.rank || null, streak: standing?.streak || 0 },
    standing,
    activity: [120,0,340,180,420,250,510,360,440,610,480,570].map((points, index) => ({ week: `W${index + 1}`, points })),
    skillPoints: [{ skill: "Python", points: 920 }, { skill: "PyTorch", points: 780 }, { skill: "FastAPI", points: 610 }, { skill: "React", points: 530 }, { skill: "SQL", points: 440 }],
    prerequisites: [{ label: "Verified identity", ready: true }, { label: "Approved evidence", ready: true }, { label: "Role resume", ready: true }, { label: "Deployment outcome", ready: false }],
    opportunityStages: [{ stage: "Discovered", count: 2 }, { stage: "Drafted", count: 1 }, { stage: "Human review", count: 2 }],
    recommendations: ["Add a verified deployment outcome to strengthen production-readiness coverage.", "Review the two opportunities waiting for a human decision."],
    community: { activeMembers: 128, verifiedPointEvents: 842, reviewedEvidence: 316, freshness: "Updated 2 minutes ago" },
    meta: { mode: "local_demo", label: "Synthetic personal demo" },
  };
}

export async function readIdentitySettings(userId: string): Promise<LeaderboardIdentitySettings> {
  if (configuredProductProvider() === "local") {
    const value = readLocalDemoState(userId).leaderboardIdentity;
    return { ...value, preview: value.mode === "anonymous" ? "Member #7A82F" : value.mode === "real_name" && value.realNameConsent ? "Alex Rivera" : value.username };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("leaderboard_identity_settings");
  if (error || !data) throw new Error(error?.message || "Identity settings are unavailable.");
  return data as unknown as LeaderboardIdentitySettings;
}

export async function usernameAvailable(userId: string, username: string) {
  leaderboardUsernameSchema.parse(username);
  if (configuredProductProvider() === "local") return username.toLowerCase() === readLocalDemoState(userId).leaderboardIdentity.username.toLowerCase() || !people.some(([name]) => name.toLowerCase() === username.toLowerCase());
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("leaderboard_username_available", { candidate: username });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function saveIdentitySettings(userId: string, input: unknown): Promise<LeaderboardIdentitySettings> {
  const value = identitySettingsSchema.parse(input);
  if (!(await usernameAvailable(userId, value.username))) throw new Error("That leaderboard username is unavailable.");
  if (configuredProductProvider() === "local") {
    const state = updateLocalDemoState(userId, (current) => ({
      ...current,
      leaderboardIdentity: { ...value, reviewRequired: false },
      privacySettings: {
        ...current.privacySettings,
        anonymousRanking: value.mode === "anonymous",
        hideRealName: value.mode === "real_name" ? false : current.privacySettings.hideRealName,
      },
    }));
    return readIdentitySettings(userId).then(() => ({ ...state.leaderboardIdentity, preview: value.mode === "anonymous" ? "Member #7A82F" : value.mode === "real_name" ? "Alex Rivera" : value.username }));
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("update_leaderboard_identity", { requested_username: value.username, requested_mode: value.mode, requested_real_name_consent: value.realNameConsent });
  if (error || !data) throw new Error(error?.message || "Identity settings could not be saved.");
  return data as unknown as LeaderboardIdentitySettings;
}
