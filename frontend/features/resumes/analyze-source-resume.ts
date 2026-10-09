import {
  resumeSourceDocumentSchema,
  type ResumeSourceDocument,
} from "@pytorch-ph/domain-protocol/resumes";

export type ResumeSourceAnalysis = {
  contract: "resume-source-analysis/v1";
  documentId: string;
  readiness: "ready" | "review_required";
  sectionCounts: Record<string, number>;
  evidenceCoverage: {
    quantitativeClaims: number;
    verifiedClaims: number;
    unsupportedClaimIds: string[];
  };
  provenanceCoverage: {
    trackedFields: number;
    confirmedFields: number;
    reviewPaths: string[];
  };
  warnings: string[];
};

export function analyzeResumeSource(input: unknown): ResumeSourceAnalysis {
  const document = resumeSourceDocumentSchema.parse(input);
  const verifiedEvidence = new Set(document.evidence
    .filter((item) => item.verification.status !== "unverified")
    .map((item) => item.id));
  const verifiedClaims = new Set(document.claimEvidenceLinks
    .filter((link) => link.relationship === "supports" && verifiedEvidence.has(link.evidenceId))
    .map((link) => link.claimId));
  const unsupportedClaimIds = document.claims
    .map((claim) => claim.id)
    .filter((id) => !verifiedClaims.has(id));
  const reviewPaths = document.fieldProvenance
    .filter((field) => field.status !== "confirmed" || field.confidence < 0.8)
    .map((field) => field.path);
  const sectionCounts = document.records.reduce<Record<string, number>>((counts, record) => {
    counts[record.kind] = (counts[record.kind] || 0) + 1;
    return counts;
  }, {});
  const warnings = analysisWarnings(document, unsupportedClaimIds, reviewPaths);

  return {
    contract: "resume-source-analysis/v1",
    documentId: document.document.id,
    readiness: warnings.length ? "review_required" : "ready",
    sectionCounts,
    evidenceCoverage: {
      quantitativeClaims: document.claims.length,
      verifiedClaims: verifiedClaims.size,
      unsupportedClaimIds,
    },
    provenanceCoverage: {
      trackedFields: document.fieldProvenance.length,
      confirmedFields: document.fieldProvenance.filter((field) => field.status === "confirmed").length,
      reviewPaths,
    },
    warnings,
  };
}

function analysisWarnings(
  document: ResumeSourceDocument,
  unsupportedClaimIds: string[],
  reviewPaths: string[],
) {
  const warnings: string[] = [];
  if (unsupportedClaimIds.length) warnings.push(`${unsupportedClaimIds.length} quantitative claim(s) lack verified supporting evidence.`);
  if (reviewPaths.length) warnings.push(`${reviewPaths.length} extracted field(s) still need human confirmation.`);
  if (!document.records.some((record) => record.kind === "skill_group")) warnings.push("No skills section is available.");
  if (!document.records.some((record) => ["experience", "project", "organization"].includes(record.kind))) {
    warnings.push("No experience, project, or organisation record is available.");
  }
  return warnings;
}
