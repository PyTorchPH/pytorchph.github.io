import type { UserTier } from "@pytorch-ph/domain-protocol/identity";

export const metrics = [
  { label: "Total Members", value: "1,284", delta: "+12.4%", trend: "up" },
  { label: "Active Members", value: "847", delta: "+8.1%", trend: "up" },
  { label: "Inactive Members", value: "437", delta: "-3.2%", trend: "down" },
  { label: "Upcoming Events", value: "14", delta: "+2", trend: "up" }
];

export const kanbanEvents = {
  planning: [
    { id: "evt-1", title: "AI Study Circles: CV Sprint", owner: "Computer Science Department", seats: 42 },
    { id: "evt-2", title: "TorchData Pipeline Clinic", owner: "AI Research Cluster", seats: 28 }
  ],
  approved: [
    { id: "evt-3", title: "Philippine Community Innovation Demo Night", owner: "External Relations", seats: 96 },
    { id: "evt-4", title: "MLOps Portfolio Review", owner: "Career Development Office", seats: 32 }
  ],
  live: [
    { id: "evt-5", title: "Deep Learning Peer Lab", owner: "Academic Affairs", seats: 64 },
    { id: "evt-6", title: "PyTorch Hack Night", owner: "Engineering Guild", seats: 120 }
  ],
  concluded: [
    { id: "evt-7", title: "NLP Reading Group: Transformers", owner: "AI Study Circles", seats: 55 },
    { id: "evt-8", title: "Computer Vision Basics Workshop", owner: "Computer Vision Guild", seats: 88 }
  ]
};

export const leaderboardRows = [
  { rank: 1, name: "Mika #7A82F", track: "Computer Vision", points: 18420, streak: 12, badges: ["CV", "Mentor"] },
  { rank: 2, name: "Jules #29C10", track: "Deep Learning", points: 17110, streak: 10, badges: ["DL", "Events"] },
  { rank: 3, name: "Ari #4D91B", track: "NLP", points: 16680, streak: 9, badges: ["NLP", "Research"] },
  { rank: 4, name: "Nia #88E2A", track: "Optimization", points: 15440, streak: 8, badges: ["Ops", "Labs"] },
  { rank: 5, name: "Ren #95F0C", track: "MLOps", points: 14180, streak: 7, badges: ["Infra", "Peer Lead"] }
];

export const skillRadar = [
  { skill: "Computer Vision", score: 86 },
  { skill: "NLP", score: 72 },
  { skill: "Optimization", score: 64 },
  { skill: "MLOps", score: 78 },
  { skill: "Data Ethics", score: 69 },
  { skill: "Research", score: 81 }
];

export const activityTrend = [
  { day: "Mon", events: 2, contributions: 24 },
  { day: "Tue", events: 1, contributions: 38 },
  { day: "Wed", events: 3, contributions: 51 },
  { day: "Thu", events: 2, contributions: 47 },
  { day: "Fri", events: 4, contributions: 62 },
  { day: "Sat", events: 5, contributions: 28 },
  { day: "Sun", events: 3, contributions: 19 }
];

export const departmentLoad = [
  { department: "Academics", open: 18, approved: 11 },
  { department: "Engineering", open: 24, approved: 15 },
  { department: "External", open: 13, approved: 9 },
  { department: "Research", open: 17, approved: 12 },
  { department: "Creatives", open: 11, approved: 8 }
];

export const barSkills = [
  { name: "Workshops", value: 18 },
  { name: "Projects", value: 9 },
  { name: "Peer Reviews", value: 14 },
  { name: "Mentoring", value: 7 }
];

export const approvalQueue = [
  {
    title: "Philippine AI Hack Sprint sponsor brief",
    department: "External Relations",
    status: "Needs treasurer approval",
    risk: "budget",
    age: "2h"
  },
  {
    title: "Vision Transformers venue request",
    department: "Academic Affairs",
    status: "Waiting for room confirmation",
    risk: "venue",
    age: "5h"
  },
  {
    title: "NLP Filipino Languages partner post",
    department: "Communications",
    status: "Human copy review",
    risk: "public",
    age: "1d"
  }
];

export const systemHealth = [
  { label: "RLS policy coverage", value: "100%", tone: "good" },
  { label: "AI drafts pending HITL", value: "7", tone: "warn" },
  { label: "Leaderboard refresh", value: "42m", tone: "info" },
  { label: "Public PII exposure", value: "0", tone: "good" }
];

export const events = [
  {
    title: "Philippine Community Innovation Hackathon",
    date: "Jul 11, 2026",
    department: "Computer Science Department",
    type: "Hackathon",
    seats: 120
  },
  {
    title: "Computer Vision Lab: Community Safety Models",
    date: "Jul 18, 2026",
    department: "AI Study Circles",
    type: "Workshop",
    seats: 48
  },
  {
    title: "NLP Paper Jam: Filipino Tech Communities",
    date: "Jul 25, 2026",
    department: "Research Cluster",
    type: "Reading Group",
    seats: 36
  },
  {
    title: "Optimization Clinic for PyTorch Training Loops",
    date: "Aug 2, 2026",
    department: "Engineering Guild",
    type: "Clinic",
    seats: 40
  }
];

export const tierSamples: UserTier[] = ["admin", "leaderboard", "active", "general"];
