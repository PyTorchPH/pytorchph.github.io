import type { EvidenceItem, ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";

const frameworkGroups: Record<string, string> = {
  FastAPI: "Python",
  PyTorch: "Python",
  React: "JavaScript",
  "Next.js": "JavaScript",
};

export function resumeProfileFromEvidence(
  items: EvidenceItem[],
  identity: Partial<Pick<ResumeProfile, "fullName" | "headline" | "email" | "location" | "summary">> = {}
): ResumeProfile | undefined {
  const approved = items.filter((item) => item.verificationState === "user_verified");
  if (!approved.length) return undefined;
  const groups = new Map<string, Set<string>>();
  for (const item of approved) {
    for (const skill of item.skills) {
      const group = frameworkGroups[skill] || "Other";
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group)?.add(skill);
    }
  }
  return {
    fullName: identity.fullName || "Career profile",
    headline: identity.headline || "Evidence-backed candidate",
    email: identity.email || "",
    location: identity.location || "",
    summary: identity.summary || "Career profile generated from user-approved normalized evidence.",
    experience: approved
      .filter((item) => item.evidenceKind === "experience" && item.role)
      .map((item) => ({
        title: item.role,
        organization: item.organization,
        dateLabel: item.dateLabel,
        bullets: [item.description, ...item.quantitative, ...item.qualitative].filter(Boolean),
      })),
    projects: approved.filter((item) => item.evidenceKind !== "experience").map((item) => ({
      title: item.title,
      summary: item.description,
      bullets: [...item.quantitative, ...item.qualitative],
    })),
    skillGroups: [...groups].map(([name, values]) => ({ name, items: [...values].sort() })),
    education: [],
  };
}
