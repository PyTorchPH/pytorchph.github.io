import assert from "node:assert/strict";
import test from "node:test";
import { evidenceFormSchema, validatedEvidenceItem, type EvidenceItem } from "@pytorch-ph/domain-protocol/career-evidence";
import { resumeProfileFromEvidence } from "@pytorch-ph/domain-server/resumes";

function evidence(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: "evidence-1", sourceId: "manual", title: "Portfolio API", organization: "",
    role: "", dateLabel: "2026", description: "Built a tested portfolio API.",
    quantitative: [], qualitative: [], skills: ["TypeScript"], mediaUrl: "/evidence.svg",
    mediaAlt: "Evidence", verificationState: "user_verified", ...overrides,
  };
}

test("resume injection keeps projects and professional experience in separate sections", () => {
  const project = evidence({ id: "project", evidenceKind: "project", role: "Project Lead" });
  const experience = evidence({ id: "experience", evidenceKind: "experience", title: "Shipped APIs", role: "Backend Engineer", organization: "Example Co" });
  const profile = resumeProfileFromEvidence([project, experience]);
  assert.deepEqual(profile?.projects.map((item) => item.title), ["Portfolio API"]);
  assert.deepEqual(profile?.experience.map((item) => item.title), ["Backend Engineer"]);
});

test("legacy input defaults to project and strips its position", () => {
  const normalized = validatedEvidenceItem({ ...evidence({}), role: "Personal Project Lead" });
  assert.equal(normalized.evidenceKind, "project");
  assert.equal(normalized.role, "");
  assert.equal(resumeProfileFromEvidence([normalized])?.experience.length, 0);
});

test("professional experience requires organization and position", () => {
  const base = { title: "Shipped APIs", dateLabel: "2026", description: "Built a production service.", skillsText: "TypeScript" };
  assert.equal(evidenceFormSchema.safeParse({ ...base, evidenceKind: "project", organization: "", role: "" }).success, true);
  assert.equal(evidenceFormSchema.safeParse({ ...base, evidenceKind: "experience", organization: "", role: "" }).success, false);
});
