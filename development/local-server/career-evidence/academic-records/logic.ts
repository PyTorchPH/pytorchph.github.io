import type { CourseGrade, HonorResult } from "@pytorch-ph/domain-protocol/career-evidence";

export const HONOR_TARGETS: ReadonlyArray<readonly [string, number]> = [
  ["Summa Cum Laude", 3.8],
  ["Magna Cum Laude", 3.6],
  ["Cum Laude", 3.4]
];

export function computeCgpa(rows: CourseGrade[]): { cgpa: number; completedUnits: number } {
  const valid = rows.filter((row) => row.units > 0 && Number.isFinite(row.finalGrade));
  const completedUnits = valid.reduce((sum, row) => sum + row.units, 0);
  const qualityPoints = valid.reduce((sum, row) => sum + row.units * row.finalGrade, 0);
  return { cgpa: completedUnits ? qualityPoints / completedUnits : 0, completedUnits };
}

export function requiredAverageForTarget(args: {
  currentCgpa: number;
  completedUnits: number;
  totalCurriculumUnits: number;
  targetCgpa: number;
}): number {
  const remaining = args.totalCurriculumUnits - args.completedUnits;
  if (remaining <= 0) return args.currentCgpa >= args.targetCgpa ? 0 : Number.POSITIVE_INFINITY;
  return (args.targetCgpa * args.totalCurriculumUnits - args.currentCgpa * args.completedUnits) / remaining;
}

export function evaluateHonors(
  currentCgpa: number,
  completedUnits: number,
  totalCurriculumUnits?: number
): HonorResult[] {
  return HONOR_TARGETS.map(([honorName, targetGpa]) => {
    const needed = totalCurriculumUnits
      ? requiredAverageForTarget({
          currentCgpa,
          completedUnits,
          totalCurriculumUnits,
          targetCgpa: targetGpa
        })
      : Number.NaN;
    return {
      honorName,
      targetGpa,
      qualifiedNow: currentCgpa >= targetGpa,
      neededAverageForRemainingUnits: needed,
      reachable: Number.isNaN(needed) || needed <= 4
    };
  });
}

export function parseTermLabel(label: string): [number, number] {
  const [term, schoolYear] = label.split("-", 2).map((part) => part.trim());
  return [Number(schoolYear.slice(0, 4)), Number(term)];
}

export function sortTermLabels(labels: string[]): string[] {
  return [...labels].sort((a, b) => {
    const [yearA, termA] = parseTermLabel(a);
    const [yearB, termB] = parseTermLabel(b);
    return yearA - yearB || termA - termB;
  });
}
