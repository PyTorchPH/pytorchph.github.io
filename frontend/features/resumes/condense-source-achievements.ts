import type { ResumeSourceDocument, ResumeSourceRecord } from "@pytorch-ph/domain-protocol/resumes";

/** Keep the source graph lossless; group only the injected presentation. */
export function condenseSourceAchievements(
  document: ResumeSourceDocument,
  record: ResumeSourceRecord,
  statements: Map<string, string>,
) {
  const paragraphs: string[] = [];
  if (record.highlights.length) paragraphs.push(joinAchievementStatements(record.highlights));
  const verifiedEvidence = new Set(document.evidence.filter((item) => item.verification.status !== "unverified").map((item) => item.id));
  const groups = new Map<string, string[]>();
  for (const claimId of record.claimIds) {
    const statement = statements.get(claimId);
    if (!statement) continue;
    const supportingIds = [...new Set(document.claimEvidenceLinks
      .filter((link) => link.claimId === claimId && link.relationship === "supports" && verifiedEvidence.has(link.evidenceId))
      .map((link) => link.evidenceId))].sort();
    // Different runs stay separate, even when their classifications or test types match.
    const key = supportingIds.length ? JSON.stringify(supportingIds) : claimId;
    const values = groups.get(key) || [];
    values.push(statement);
    groups.set(key, values);
  }
  return [...paragraphs, ...[...groups.values()].map(joinAchievementStatements)];
}

function joinAchievementStatements(statements: string[]) {
  if (statements.length === 1) return statements[0].trim();
  const values = [...new Set(statements.map((statement) => statement.trim().replace(/[.;]$/, "")))];
  return `${values.join("; ")}.`;
}
