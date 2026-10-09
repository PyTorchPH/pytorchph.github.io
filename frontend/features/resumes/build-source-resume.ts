import type { ResumeProfile, ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";
import {
  resumeSourceDocumentSchema,
  type ResumeSourceDocument,
  type ResumeSourceRecord,
  type ResumeSourceRecordKind,
} from "@pytorch-ph/domain-protocol/resumes";

const defaultSectionOrder: ResumeSourceRecordKind[] = [
  "skill_group",
  "experience",
  "project",
  "organization",
  "certificate",
  "award",
  "publication",
  "education",
  "language",
  "interest",
  "reference",
  "custom",
];

const defaultSectionLabels: Record<ResumeSourceRecordKind, string> = {
  experience: "Professional experience",
  project: "Projects",
  education: "Education",
  skill_group: "Skills",
  organization: "Organisations",
  award: "Awards",
  certificate: "Certificates",
  publication: "Publications",
  language: "Languages",
  interest: "Interests",
  reference: "References",
  custom: "Additional information",
};

export function buildResumeSourceProfile(input: unknown, targetId?: string): ResumeProfile {
  const document = resumeSourceDocumentSchema.parse(input);
  const target = targetId ? document.targets.find((candidate) => candidate.id === targetId) : undefined;
  if (targetId && !target) throw new Error(`Unknown resume target: ${targetId}`);

  const records = document.records.filter((record) =>
    !targetId || record.targetIds.length === 0 || record.targetIds.includes(targetId)
  );
  const statements = verifiedClaimStatements(document, targetId);
  const skills = new Map(document.skills.map((skill) => [skill.id, skill.name]));
  const sectionOrder = orderedKinds(document, records);
  const sections = sectionOrder
    .map((kind) => buildSection(document, records.filter((record) => record.kind === kind), kind, statements, skills))
    .filter((section): section is ResumeProfileSection => Boolean(section));
  const contacts = document.person.contacts.filter((contact) => contact.visibility === "resume");
  const contact = (kind: "email" | "phone" | "location" | "website") => contacts.find((item) => item.kind === kind);
  const linkedIn = document.person.profiles.find((profile) => profile.network.toLowerCase() === "linkedin");
  const links = [
    ...contacts.filter((item) => item.kind === "website" || item.kind === "other").flatMap((item) => item.url ? [{ label: item.label || item.value, url: item.url }] : []),
    ...document.person.profiles.map((profile) => ({ label: profile.network, url: profile.url })),
  ];

  return {
    fullName: document.person.name.display,
    headline: target?.role || document.person.positioning.headline,
    email: contact("email")!.value,
    phone: contact("phone")!.value,
    location: contact("location")!.value,
    personalWebsite: contact("website")?.url || contact("website")?.value,
    linkedIn: linkedIn?.url,
    links,
    summary: document.person.positioning.summary || "",
    experience: legacyExperience(records, statements),
    projects: legacyProjects(records, statements),
    skillGroups: records.filter((record) => record.kind === "skill_group").map((record) => ({
      name: record.name,
      items: [...record.skills, ...record.skillIds.flatMap((id) => skills.get(id) || [])],
    })),
    education: records.filter((record) => record.kind === "education").map((record) => ({
      school: record.organization!,
      program: record.name,
      dateLabel: periodLabel(record),
    })),
    sections,
    presentation: {
      density: document.presentationHints.density,
      pageGoal: document.presentationHints.pageGoal,
    },
  };
}

function orderedKinds(document: ResumeSourceDocument, records: ResumeSourceRecord[]) {
  const requested = document.presentationHints.sectionOrder;
  const order = requested.length ? requested : defaultSectionOrder;
  const present = new Set(records.map((record) => record.kind));
  return [...order, ...defaultSectionOrder.filter((kind) => !order.includes(kind))]
    .filter((kind, index, values) => present.has(kind) && values.indexOf(kind) === index);
}

function buildSection(
  document: ResumeSourceDocument,
  records: ResumeSourceRecord[],
  kind: ResumeSourceRecordKind,
  statements: Map<string, string>,
  skills: Map<string, string>,
): ResumeProfileSection | undefined {
  if (!records.length) return undefined;
  const layout = document.presentationHints.sectionLayouts[kind];
  return {
    id: kind,
    title: document.presentationHints.sectionLabels[kind] || defaultSectionLabels[kind],
    layout: layout?.mode,
    columns: layout?.columns,
    items: records.map((record) => ({
      id: record.id,
      heading: record.name,
      subheading: record.role || record.organization || record.issuer,
      dateLabel: periodLabel(record) || undefined,
      summary: record.summary,
      bullets: [...record.highlights, ...record.claimIds.flatMap((id) => statements.get(id) || [])],
      inlineItems: [...record.skills, ...record.skillIds.flatMap((id) => skills.get(id) || [])],
      links: record.links,
    })),
  };
}

function verifiedClaimStatements(document: ResumeSourceDocument, targetId?: string) {
  const evidence = new Map(document.evidence.map((item) => [item.id, item]));
  const target = targetId ? document.targets.find((candidate) => candidate.id === targetId) : undefined;
  const statements = new Map<string, string>();
  document.claims.forEach((claim) => {
    const links = document.claimEvidenceLinks.filter((link) => link.claimId === claim.id && link.relationship === "supports");
    const verified = links.map((link) => evidence.get(link.evidenceId)).filter((item) => item && item.verification.status !== "unverified");
    const classificationMatches = !target || target.preferredClassificationCodes.length === 0
      || claim.classificationCodes.some((code) => target.preferredClassificationCodes.includes(code));
    const testTypeMatches = !target || target.preferredTestTypes.length === 0
      || verified.some((item) => target.preferredTestTypes.includes(item!.testType));
    if (verified.length && classificationMatches && testTypeMatches) statements.set(claim.id, claim.statement);
  });
  return statements;
}

function legacyExperience(records: ResumeSourceRecord[], statements: Map<string, string>) {
  return records.filter((record) => record.kind === "experience").map((record) => ({
    title: record.role || record.name,
    organization: record.organization!,
    dateLabel: periodLabel(record),
    bullets: [...record.highlights, ...record.claimIds.flatMap((id) => statements.get(id) || [])],
  }));
}

function legacyProjects(records: ResumeSourceRecord[], statements: Map<string, string>) {
  return records.filter((record) => record.kind === "project").map((record) => ({
    title: record.name,
    summary: record.summary || "",
    bullets: [...record.highlights, ...record.claimIds.flatMap((id) => statements.get(id) || [])],
  }));
}

function periodLabel(record: ResumeSourceRecord) {
  if (!record.period) return "";
  if (record.period.label) return record.period.label;
  return [record.period.start, record.period.end].filter(Boolean).join(" – ");
}
