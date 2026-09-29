import type { DiscordManagedRoleKey } from "./access-policy";

export type DiscordCommunityRole = {
  key: string;
  name: string;
  authority: "discord" | "website" | "member" | "system";
  permissions: string[];
  hoisted: boolean;
  mentionable: boolean;
};

export type DiscordCommunityChannel = {
  key: string;
  name: string;
  category: "START HERE" | "COMMUNITY" | "LEARNING PATHS" | "VOICE" | "STAFF";
  kind: "text" | "forum" | "voice" | "stage";
  defaultChannel: boolean;
  writableByEveryone: boolean;
  requiredRoleKeys: string[];
  slowmodeSeconds?: number;
};

const websiteRole = (key: DiscordManagedRoleKey, name: string): DiscordCommunityRole => ({
  key,
  name,
  authority: "website",
  permissions: [],
  hoisted: false,
  mentionable: false,
});

export const discordCommunityBlueprint = {
  identity: {
    brand: "PyTorch PH",
    botName: "PyTorch PH",
    defaultLocale: "en-US",
  },
  security: {
    communityEnabled: true,
    verificationLevel: "medium",
    explicitContentFilter: "all_members",
    defaultNotifications: "only_mentions",
    require2FAForModeration: true,
    raidProtection: true,
    runtimeBotPermissions: ["ManageRoles"],
    temporaryBootstrapPermissions: ["ManageGuild", "ManageRoles", "ManageChannels", "ManageEvents"],
    removeBootstrapPermissionsAfterProvisioning: true,
    privilegedRolesAreManualOnly: true,
  },
  roleOrderTopToBottom: [
    "administrator",
    "moderator",
    "event-host",
    "pytorch-ph-bot",
    "leaderboard-member",
    "active-member",
    "verified-member",
    "access-mentor",
    "access-advanced",
    "access-builder",
    "rank-master",
    "rank-diamond",
    "rank-platinum",
    "rank-gold",
    "rank-silver",
    "rank-bronze",
    "interest-mentor",
    "interest-research",
    "interest-build",
    "interest-learn",
    "events-notify",
  ],
  roles: [
    { key: "administrator", name: "Administrator", authority: "discord", permissions: ["Administrator"], hoisted: true, mentionable: false },
    { key: "moderator", name: "Moderator", authority: "discord", permissions: ["ViewAuditLog", "ManageMessages", "ManageThreads", "ModerateMembers", "KickMembers", "BanMembers"], hoisted: true, mentionable: false },
    { key: "event-host", name: "Event Host", authority: "discord", permissions: ["ManageEvents", "MuteMembers", "MoveMembers"], hoisted: true, mentionable: true },
    { key: "pytorch-ph-bot", name: "PyTorch PH Bot", authority: "system", permissions: ["ManageRoles"], hoisted: false, mentionable: false },
    websiteRole("leaderboard-member", "Leaderboard Member"),
    websiteRole("active-member", "Active Member"),
    websiteRole("verified-member", "Verified Member"),
    websiteRole("access-mentor", "Mentor Access"),
    websiteRole("access-advanced", "Advanced Access"),
    websiteRole("access-builder", "Builder Access"),
    ...(["master", "diamond", "platinum", "gold", "silver", "bronze"] as const).map((family) => websiteRole(`rank-${family}`, family[0].toUpperCase() + family.slice(1))),
    ...[
      ["interest-mentor", "Mentoring"],
      ["interest-research", "Research"],
      ["interest-build", "Project Building"],
      ["interest-learn", "Learning Fundamentals"],
      ["events-notify", "Event Notifications"],
    ].map(([key, name]) => ({ key, name, authority: "member" as const, permissions: [], hoisted: false, mentionable: false })),
  ] satisfies DiscordCommunityRole[],
  channels: [
    { key: "welcome-rules", name: "welcome-and-rules", category: "START HERE", kind: "text", defaultChannel: true, writableByEveryone: false, requiredRoleKeys: [] },
    { key: "announcements", name: "announcements", category: "START HERE", kind: "text", defaultChannel: true, writableByEveryone: false, requiredRoleKeys: [] },
    { key: "general", name: "general", category: "COMMUNITY", kind: "text", defaultChannel: true, writableByEveryone: true, requiredRoleKeys: [], slowmodeSeconds: 5 },
    { key: "introductions", name: "introductions", category: "COMMUNITY", kind: "text", defaultChannel: true, writableByEveryone: true, requiredRoleKeys: [], slowmodeSeconds: 30 },
    { key: "help-desk", name: "help-desk", category: "COMMUNITY", kind: "forum", defaultChannel: true, writableByEveryone: true, requiredRoleKeys: [] },
    { key: "showcase", name: "project-showcase", category: "COMMUNITY", kind: "forum", defaultChannel: true, writableByEveryone: true, requiredRoleKeys: [] },
    { key: "events", name: "events", category: "COMMUNITY", kind: "forum", defaultChannel: true, writableByEveryone: true, requiredRoleKeys: [] },
    { key: "beginner-lab", name: "beginner-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["verified-member"] },
    { key: "builder-lab", name: "builder-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["access-builder"] },
    { key: "advanced-lab", name: "advanced-lab", category: "LEARNING PATHS", kind: "forum", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["access-advanced"] },
    { key: "mentor-circle", name: "mentor-circle", category: "LEARNING PATHS", kind: "forum", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["access-mentor"] },
    { key: "community-lounge", name: "Community Lounge", category: "VOICE", kind: "voice", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["verified-member"] },
    { key: "study-room", name: "Study Room", category: "VOICE", kind: "voice", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["verified-member"] },
    { key: "event-stage", name: "Event Stage", category: "VOICE", kind: "stage", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["verified-member"] },
    { key: "mod-ops", name: "mod-ops", category: "STAFF", kind: "text", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["moderator", "administrator"] },
    { key: "automod-alerts", name: "automod-alerts", category: "STAFF", kind: "text", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["moderator", "administrator"] },
    { key: "audit-log", name: "audit-log", category: "STAFF", kind: "text", defaultChannel: false, writableByEveryone: false, requiredRoleKeys: ["moderator", "administrator"] },
  ] satisfies DiscordCommunityChannel[],
  eventAccess: [
    { key: "beginner", label: "Beginner", requiredRoleKey: "verified-member" },
    { key: "builder", label: "Builder", requiredRoleKey: "access-builder" },
    { key: "advanced", label: "Advanced", requiredRoleKey: "access-advanced" },
    { key: "mentor", label: "Mentor / Expert", requiredRoleKey: "access-mentor" },
  ],
  onboarding: {
    requiredQuestions: [
      {
        prompt: "What do you want to focus on?",
        multiple: true,
        answers: [
          { label: "Learn fundamentals", roleKey: "interest-learn" },
          { label: "Build projects", roleKey: "interest-build" },
          { label: "Explore research", roleKey: "interest-research" },
          { label: "Mentor and share", roleKey: "interest-mentor" },
        ],
      },
    ],
    optionalQuestions: [{ prompt: "Which updates do you want?", multiple: true, answers: [{ label: "Events", roleKey: "events-notify" }] }],
    serverGuideTasks: ["Read the community rules", "Link your PyTorch PH account", "Introduce yourself", "Choose a learning path"],
  },
  rules: [
    "Treat every member with respect. Harassment, hate speech, threats, and targeted abuse are prohibited.",
    "Keep discussions relevant to the selected channel or forum tag; use threads for extended side discussions.",
    "Do not spam, mass-mention, impersonate others, or post unsolicited promotions and server invites.",
    "Do not share malware, phishing links, scams, credential requests, or instructions that compromise accounts or systems.",
    "Protect privacy: do not publish private messages, personal data, access tokens, passwords, or confidential project material.",
    "Represent skills, credentials, project ownership, and contributions truthfully; plagiarism and fabricated evidence are prohibited.",
    "Follow moderator directions. Use the private appeal path for disputes instead of escalating them in public channels.",
  ],
  automod: [
    { key: "common-harmful-content", trigger: "keyword_preset", presets: ["profanity", "sexual_content", "slurs"], actions: ["block_message", "send_alert"], exemptRoleKeys: ["moderator", "administrator"] },
    { key: "phishing-and-scams", trigger: "keyword", keywords: ["*free nitro*", "*claim your gift*", "*wallet verification*", "*verify your account here*"], actions: ["block_message", "send_alert"], exemptRoleKeys: [] },
    { key: "unauthorized-invites", trigger: "keyword", keywords: ["*discord.gg/*", "*discord.com/invite/*"], actions: ["block_message", "send_alert"], exemptRoleKeys: ["event-host", "moderator", "administrator"] },
    { key: "mention-spam", trigger: "mention_spam", mentionLimit: 5, actions: ["block_message", "send_alert", "timeout_10m"], exemptRoleKeys: ["moderator", "administrator"] },
    { key: "spam-content", trigger: "spam", actions: ["block_message", "send_alert"], exemptRoleKeys: ["moderator", "administrator"] },
  ],
  integrations: {
    required: ["PyTorch PH custom Discord application"],
    thirdPartyBots: [],
    nativeFeatures: ["Community Onboarding", "Server Guide", "AutoMod", "Raid Protection", "Scheduled Events", "Forum Channels"],
  },
} as const;
