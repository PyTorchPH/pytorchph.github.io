import type { ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";
import {
  assessClaimEvidence,
  evidenceBackedResumeSchema,
  promoteResumeDraft,
  type EvidenceBackedResume,
  type RenderableEvidenceResume,
} from "@pytorch-ph/domain-protocol/resumes";

export function buildRenderableResume(
  input: unknown,
  targetId: string,
): ResumeProfile {
  if (isEvidenceGraph(input)) return buildEvidenceGraphResume(input, targetId);
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

function buildEvidenceGraphResume(input: unknown, targetId: string): ResumeProfile {
  const document = promoteResumeDraft(input);
  const target = document.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Unknown resume target: ${targetId}`);

  const claims = new Map(document.claims.map((claim) => [claim.id, claim]));
  const evidence = new Map(document.evidence.map((item) => [item.id, item]));
  const linksByClaim = new Map<string, typeof document.claimEvidenceLinks>();
  document.claimEvidenceLinks.forEach((link) => {
    const links = linksByClaim.get(link.claimId) || [];
    links.push(link);
    linksByClaim.set(link.claimId, links);
  });

  const entryMatchesTarget = (entry: RenderableEvidenceResume["entries"][number]) =>
    entry.targetIds.length === 0 || entry.targetIds.includes(targetId);
  const claimMatchesTarget = (claimId: string) => {
    const claim = claims.get(claimId);
    if (!claim) return false;
    const supportLinks = (linksByClaim.get(claimId) || []).filter((link) => link.relationship === "supports");
    const verifiedEvidence = supportLinks
      .map((link) => evidence.get(link.evidenceId))
      .filter((item) => item && item.verification.status !== "unverified");
    const classificationMatches = target.preferredClassificationCodes.length === 0
      || claim.classificationCodes.some((code) => target.preferredClassificationCodes.includes(code));
    const testTypeMatches = target.preferredTestTypes.length === 0
      || verifiedEvidence.some((item) => target.preferredTestTypes.includes(item!.testType));
    return verifiedEvidence.length > 0 && classificationMatches && testTypeMatches;
  };
  const bullets = (entry: RenderableEvidenceResume["entries"][number]) => entry.claimIds
    .filter(claimMatchesTarget)
    .map((claimId) => claims.get(claimId)!.statement);
  const entries = document.entries.filter(entryMatchesTarget);
  const summaries = document.narratives.filter((narrative) =>
    narrative.targetId === targetId
    && (narrative.sourceClaimIds.length === 0 || narrative.sourceClaimIds.every(claimMatchesTarget))
  );

  return {
    fullName: document.profile.fullName,
    headline: target.role,
    email: document.profile.email,
    phone: document.profile.phone,
    location: document.profile.location,
    personalWebsite: document.profile.personalWebsite,
    linkedIn: document.profile.linkedIn,
    summary: summaries.map((narrative) => narrative.text).join(" "),
    experience: entries.filter((entry) => entry.section === "experience").map((entry) => ({
      title: entry.title!, organization: entry.organization!, dateLabel: entry.dateLabel!, bullets: bullets(entry),
    })),
    projects: entries.filter((entry) => entry.section === "projects").map((entry) => ({
      title: entry.title!, summary: entry.summary!, bullets: bullets(entry),
    })),
    skillGroups: entries.filter((entry) => entry.section === "skills").map((entry) => ({
      name: entry.title || "Skills", items: entry.skills,
    })),
    education: entries.filter((entry) => entry.section === "education").map((entry) => ({
      school: entry.organization!, program: entry.title!, dateLabel: entry.dateLabel!,
    })),
  };
}

function isEvidenceGraph(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && "contract" in input && input.contract === "evidence-backed-resume/v2");
}
