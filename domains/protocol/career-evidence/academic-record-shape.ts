export type CourseGrade = {
  termLabel: string;
  courseCode: string;
  courseTitle: string;
  units: number;
  finalGrade: number;
};

export type HonorResult = {
  honorName: string;
  targetGpa: number;
  qualifiedNow: boolean;
  neededAverageForRemainingUnits: number;
  reachable: boolean;
};

export type AcademicSnapshot = {
  source: "feu-tech-solar";
  scrapedAt: string;
  courses: CourseGrade[];
  termLabels: string[];
  cgpa: number;
  completedUnits: number;
  totalCurriculumUnits?: number;
  honors: HonorResult[];
};

export type ResumeAcademicHighlight = {
  label: string;
  value: string;
  source: "feu-tech-solar";
  verified_at: string;
};
