import type { ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";
import {
  assessClaimEvidence,
  evidenceBackedResumeSchema,
  type EvidenceBackedResume,
} from "@pytorch-ph/domain-protocol/resumes";

export function buildRenderableResume(
  input: unknown,
  targetId: string,
): ResumeProfile {
  const document = evidenceBackedResumeSchema.parse(input);
  const selected = document.entries.filter((entry) => entry.claims.some((claim) =>
    claim.output.include
    && claim.output.targetIds.includes(targetId)
    && assessClaimEvidence(claim).resumeEligible,
  ));
  const bullets = (entry: EvidenceBackedResume["entries"][number]) => entry.claims
    .filter((claim) => claim.output.include && claim.output.targetIds.includes(targetId) && assessClaimEvidence(claim).resumeEligible)
    .map((claim) => claim.output.renderedText);

  return {
    fullName: document.subject.name,
    headline: document.subject.label,
    email: document.subject.email,
    location: document.subject.location,
    summary: selected.filter((entry) => entry.section === "summary").flatMap(bullets).join(" "),
    experience: selected.filter((entry) => entry.section === "experience").map((entry) => ({
      title: entry.title, organization: entry.organization, dateLabel: entry.dateLabel, bullets: bullets(entry),
    })),
    projects: selected.filter((entry) => entry.section === "projects").map((entry) => ({
      title: entry.title, summary: entry.summary, bullets: bullets(entry),
    })),
    skillGroups: selected.filter((entry) => entry.section === "skills").map((entry) => ({
      name: entry.title, items: entry.skills,
    })),
    education: selected.filter((entry) => entry.section === "education").map((entry) => ({
      school: entry.organization, program: entry.title, dateLabel: entry.dateLabel,
    })),
  };
}
