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

export type PeerTutorial = { id: string; topic: string; summary: string; level: "beginner" | "builder" | "advanced"; format: string; tutor: string };

// Sample tutorials that members could offer one another. Tutor names are fictional sample handles.
export const communityPeerTutorials: PeerTutorial[] = [
  { id: "tensors-autograd", topic: "Tensors and autograd from scratch", summary: "Build intuition for tensors, gradients, and a first training loop.", level: "beginner", format: "1-on-1 · 45 minutes", tutor: "Sample Mentor A" },
  { id: "first-image-classifier", topic: "Your first image classifier", summary: "Train and evaluate a small vision model on a public dataset.", level: "beginner", format: "Small group · 60 minutes", tutor: "Sample Builder B" },
  { id: "debugging-training", topic: "Debugging a training run", summary: "Read loss curves, find data leaks, and fix exploding gradients.", level: "builder", format: "1-on-1 · 45 minutes", tutor: "Sample Mentor C" },
  { id: "serving-fastapi", topic: "Serving a model with FastAPI", summary: "Wrap a trained model in an API and test it end to end.", level: "builder", format: "Pair session · 60 minutes", tutor: "Sample Builder D" },
  { id: "paper-reading", topic: "Reading a research paper together", summary: "Walk through one paper and reproduce its key result.", level: "advanced", format: "Small group · 90 minutes", tutor: "Sample Mentor E" },
  { id: "distributed-training", topic: "Distributed training basics", summary: "Scale a training job across GPUs and measure the speed-up.", level: "advanced", format: "1-on-1 · 60 minutes", tutor: "Sample Mentor A" },
];

// New and unlinked members start with beginner tutorials; mentors are a good fit to take advanced ones.
export function tutorialFitsBand(tutorial: PeerTutorial, accessBand: string) {
  const level = accessBand === "mentor" ? "advanced" : accessBand === "none" ? "beginner" : accessBand;
  return tutorial.level === level;
}
