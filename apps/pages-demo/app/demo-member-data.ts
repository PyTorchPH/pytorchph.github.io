import type { MemberOverview } from "@pytorch-ph/domain-protocol/leaderboards";

export const demoMemberData = {
  summary: { verifiedEvidence: 6, readyResumes: 3, registeredEvents: 2, activeOpportunities: 5, points: 3280, rank: 7, streak: 5 },
  standing: null,
  activity: [120, 0, 340, 180, 420, 250, 510, 360, 440, 610, 480, 570].map((points, index) => ({ week: `W${index + 1}`, points })),
  skillPoints: [{ skill: "Python", points: 920 }, { skill: "PyTorch", points: 780 }, { skill: "FastAPI", points: 610 }, { skill: "React", points: 530 }, { skill: "SQL", points: 440 }],
  prerequisites: [{ label: "Verified identity", ready: true }, { label: "Approved evidence", ready: true }, { label: "Role resume", ready: true }, { label: "Deployment outcome", ready: false }],
  opportunityStages: [{ stage: "Discovered", count: 2 }, { stage: "Drafted", count: 1 }, { stage: "Human review", count: 2 }],
  recommendations: ["Add a verified deployment outcome to strengthen production-readiness coverage.", "Review the two opportunities waiting for a human decision."],
  community: { activeMembers: 128, verifiedPointEvents: 842, reviewedEvidence: 316, freshness: "Synthetic sample" },
  meta: { mode: "local_demo", label: "Synthetic personal demo" },
} satisfies MemberOverview;
