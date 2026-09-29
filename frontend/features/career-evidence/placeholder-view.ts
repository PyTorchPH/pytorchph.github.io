// Empty-but-shaped workspace data, so a page can draw its layout before (or without) real data.
// Every value is visibly empty: no synthetic numbers are shown as if they were real.
// Module map (caller-first):
//   placeholderView       ProductView → ProductViewData with empty collections
//   WORKSPACE_HEADINGS    the hero text each workspace shows before its data arrives

import type { ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";

export const WORKSPACE_HEADINGS: Record<ProductView, ProductViewData["heading"]> = {
  dashboard: { eyebrow: "Member portal", title: "Dashboard", description: "Your workspace at a glance." },
  "career-evidence": { eyebrow: "Career workspace", title: "Career Evidence", description: "Collect, verify, and organize the evidence behind your skills." },
  resumes: { eyebrow: "Career workspace", title: "Resume Studio", description: "Turn approved Career Evidence into role-specific resumes." },
  "job-operations": { eyebrow: "Career workspace", title: "Job automation", description: "Track application goals and the human review gates around them." },
  opportunities: { eyebrow: "Career workspace", title: "Opportunities", description: "Keep the roles you are targeting and how well your evidence fits them." },
  connections: { eyebrow: "Career workspace", title: "Connections", description: "Approved sessions and services your workspace can use." },
  advisor: { eyebrow: "Career workspace", title: "Career Advisor", description: "Recommendations grounded in your verified evidence." },
};

export function placeholderView(view: ProductView): ProductViewData {
  return {
    meta: { source: "live", provider: "local", mode: "production", synthetic: false, generatedAt: "", label: "Data unavailable" },
    heading: WORKSPACE_HEADINGS[view],
    stats: [],
    evidence: { ready: false, phase: "—", profileFacts: [], sources: [], skills: [], blockers: [], items: [] },
    resumes: [],
    operations: { goalLabel: "Application goal", completed: 0, target: 0, activeWorkers: 0, reviews: [] },
    opportunities: [],
    connections: [],
    recommendations: [],
  };
}
