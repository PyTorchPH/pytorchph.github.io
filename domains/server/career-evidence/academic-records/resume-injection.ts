import type {
  AcademicSnapshot,
  ResumeAcademicHighlight,
} from "@pytorch-ph/domain-protocol/career-evidence";

export function buildAcademicHighlights(snapshot: AcademicSnapshot): ResumeAcademicHighlight[] {
  const highlights: ResumeAcademicHighlight[] = [{
    label: "Cumulative GPA",
    value: `${snapshot.cgpa.toFixed(2)} / 4.00 (${snapshot.completedUnits.toFixed(1)} completed units)`,
    source: snapshot.source,
    verified_at: snapshot.scrapedAt
  }];
  const standing = snapshot.honors.find((honor) => honor.qualifiedNow);
  if (standing) highlights.push({
    label: "Current academic standing",
    value: standing.honorName,
    source: snapshot.source,
    verified_at: snapshot.scrapedAt
  });
  return highlights;
}

export function injectAcademicHighlights<T extends { academic_highlights?: ResumeAcademicHighlight[] }>(
  resume: T,
  snapshot: AcademicSnapshot
): T {
  return { ...resume, academic_highlights: buildAcademicHighlights(snapshot) };
}
