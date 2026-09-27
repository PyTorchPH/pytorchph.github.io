import { rankForPoints } from "@pytorch-ph/domain-protocol/leaderboards";

type DemoChannel = {
  key: string;
  name: string;
  category: "START HERE" | "COMMUNITY" | "LEARNING PATHS" | "VOICE";
  kind: "text" | "forum" | "voice" | "stage";
  defaultChannel: boolean;
};

const channels: DemoChannel[] = [
  { key: "welcome-rules", name: "welcome-and-rules", category: "START HERE", kind: "text", defaultChannel: true },
  { key: "announcements", name: "announcements", category: "START HERE", kind: "text", defaultChannel: true },
  { key: "general", name: "general", category: "COMMUNITY", kind: "text", defaultChannel: true },
  { key: "introductions", name: "introductions", category: "COMMUNITY", kind: "text", defaultChannel: true },
  { key: "help-desk", name: "help-desk", category: "COMMUNITY", kind: "forum", defaultChannel: true },
  { key: "showcase", name: "project-showcase", category: "COMMUNITY", kind: "forum", defaultChannel: true },
  { key: "events", name: "events", category: "COMMUNITY", kind: "forum", defaultChannel: true },
  { key: "beginner-lab", name: "beginner-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false },
  { key: "builder-lab", name: "builder-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false },
  { key: "advanced-lab", name: "advanced-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false },
  { key: "mentor-circle", name: "mentor-circle", category: "LEARNING PATHS", kind: "forum", defaultChannel: false },
  { key: "community-lounge", name: "Community Lounge", category: "VOICE", kind: "voice", defaultChannel: false },
  { key: "study-room", name: "Study Room", category: "VOICE", kind: "voice", defaultChannel: false },
  { key: "event-stage", name: "Event Stage", category: "VOICE", kind: "stage", defaultChannel: false },
];

const voiceChannels = ["community-lounge", "study-room", "event-stage"];
const beginnerChannels = ["beginner-lab", ...voiceChannels];
const builderChannels = [...beginnerChannels, "builder-lab"];
const advancedChannels = [...builderChannels, "advanced-lab"];
const mentorChannels = [...advancedChannels, "mentor-circle"];

export const communityDemoProfiles = [
  { id: "newcomer", label: "New visitor", note: "Account not linked yet", accessBand: "none", verifiedPoints: 0, roleNames: [], unlockedChannelKeys: [], unlockedEventKeys: [] },
  { id: "beginner", label: "Beginner", note: "Linked account · 120 verified points", accessBand: "beginner", verifiedPoints: 120, roleNames: ["Verified Member"], unlockedChannelKeys: beginnerChannels, unlockedEventKeys: ["beginner"] },
  { id: "builder", label: "Builder", note: "Active member · 900 verified points", accessBand: "builder", verifiedPoints: 900, roleNames: ["Verified Member", "Active Member", "Builder Access"], unlockedChannelKeys: builderChannels, unlockedEventKeys: ["beginner", "builder"] },
  { id: "advanced", label: "Advanced", note: "2,300 verified points", accessBand: "advanced", verifiedPoints: 2_300, roleNames: ["Verified Member", "Active Member", "Leaderboard Member", "Builder Access", "Advanced Access"], unlockedChannelKeys: advancedChannels, unlockedEventKeys: ["beginner", "builder", "advanced"] },
  { id: "mentor", label: "Mentor", note: "Five verified credentials", accessBand: "mentor", verifiedPoints: 180, roleNames: ["Verified Member", "Active Member", "Builder Access", "Advanced Access", "Mentor Access"], unlockedChannelKeys: mentorChannels, unlockedEventKeys: ["beginner", "builder", "advanced", "mentor"] },
] as const;

export const communityInterestOptions = [
  { label: "Learn fundamentals", roleKey: "interest-learn" },
  { label: "Build projects", roleKey: "interest-build" },
  { label: "Explore research", roleKey: "interest-research" },
  { label: "Mentor and share", roleKey: "interest-mentor" },
] as const;

const interestChannels: Record<string, string[]> = {
  "interest-learn": ["beginner-lab", "study-room"],
  "interest-build": ["builder-lab", "showcase", "community-lounge"],
  "interest-research": ["advanced-lab", "study-room"],
  "interest-mentor": ["mentor-circle", "event-stage"],
};

const eventBands = [
  { key: "beginner", label: "Beginner" },
  { key: "builder", label: "Builder" },
  { key: "advanced", label: "Advanced" },
  { key: "mentor", label: "Mentor / Expert" },
] as const;

export function communityDemoView(profileId: string, selectedInterests: readonly string[]) {
  const profile = communityDemoProfiles.find((item) => item.id === profileId) ?? communityDemoProfiles[0];
  const unlockedKeys = new Set<string>(profile.unlockedChannelKeys);
  const availableChannels = channels.filter((channel) => channel.defaultChannel || unlockedKeys.has(channel.key));
  const lockedChannels = channels.filter((channel) => !availableChannels.includes(channel));
  const recommendedKeys = new Set(selectedInterests.flatMap((key) => interestChannels[key] ?? []));
  return {
    profile,
    rankFamily: profile.accessBand === "none" ? null : rankForPoints(profile.verifiedPoints).tier.toLowerCase(),
    availableChannels,
    lockedChannels,
    recommendedKeys,
    eventBands: eventBands.map((event) => ({ ...event, unlocked: (profile.unlockedEventKeys as readonly string[]).includes(event.key) })),
  };
}
