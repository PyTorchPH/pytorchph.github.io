import { z } from "zod";

export const identityModeSchema = z.enum(["nickname", "anonymous", "real_name"]);
export const leaderboardUsernameSchema = z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/, "Use only letters, numbers, underscores, and hyphens.");
export const identitySettingsSchema = z.object({ username: leaderboardUsernameSchema, mode: identityModeSchema, realNameConsent: z.boolean() }).strict().superRefine((value, context) => {
  if (value.mode === "real_name" && !value.realNameConsent) context.addIssue({ code: "custom", message: "Real-name mode requires explicit consent.", path: ["realNameConsent"] });
});

export type LeaderboardIdentitySettings = z.infer<typeof identitySettingsSchema> & { reviewRequired: boolean; preview: string };
export const leaderboardViewSchema = z.enum(["both", "verified", "pending"]);
export type LeaderboardView = z.infer<typeof leaderboardViewSchema>;
export type LeaderboardEntry = { rank: number; displayLabel: string; tier: string; division: string; points: number; verifiedPoints: number; pendingPoints: number; streak: number; verifiedSkills: string[]; isCurrentUser: boolean };
export type LeaderboardPayload = {
  season: { slug: string; label: string; state: "active" | "completed"; startsAt: string; endsAt: string };
  entries: LeaderboardEntry[];
  page: number; pageSize: number; total: number;
  skills: Array<{ slug: string; label: string }>;
  seasons: Array<{ slug: string; label: string; state: "active" | "completed" }>;
  view: LeaderboardView;
  meta: { mode: "local_demo" | "production"; label: string };
};
export type MemberOverview = {
  summary: { verifiedEvidence: number; readyResumes: number; registeredEvents: number; activeOpportunities: number; points: number; rank: number | null; streak: number };
  standing: LeaderboardEntry | null;
  activity: Array<{ week: string; points: number }>;
  skillPoints: Array<{ skill: string; points: number }>;
  prerequisites: Array<{ label: string; ready: boolean }>;
  opportunityStages: Array<{ stage: string; count: number }>;
  recommendations: string[];
  community: { activeMembers: number; verifiedPointEvents: number; reviewedEvidence: number; freshness: string };
  meta: { mode: "local_demo" | "production"; label: string };
};

const thresholds = ["Bronze III","Bronze II","Bronze I","Silver III","Silver II","Silver I","Gold III","Gold II","Gold I","Platinum III","Platinum II","Platinum I","Diamond III","Diamond II","Diamond I","Master III","Master II","Master I"];
export function rankForPoints(points: number) {
  const index = Math.max(0, Math.min(thresholds.length - 1, Math.floor(points / 250)));
  const [tier, division] = thresholds[index].split(" ");
  return { tier, division, floor: index * 250, ceiling: index === thresholds.length - 1 ? null : (index + 1) * 250 };
}
