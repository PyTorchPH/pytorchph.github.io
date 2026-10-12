export type ResumeTemplateId = "classic" | "moderncv" | "engineeringresumes" | "engineeringclassic" | "sb2nov" | "harvard" | "ember" | "ink" | "opal" | "modern" | "compact";

export type ResumeTemplate = {
  id: ResumeTemplateId;
  name: string;
  description: string;
  accent: string;
  density: string;
};

// Kept as the stable legacy export for callers that render the original three cards.
export const resumeTemplates: ResumeTemplate[] = [
  { id: "classic", name: "Classic", description: "Traditional hierarchy with generous spacing.", accent: "#0f172a", density: "Comfortable" },
  { id: "modern", name: "Modern", description: "Balanced professional layout with a clear accent.", accent: "#004f90", density: "Balanced" },
  { id: "compact", name: "Compact", description: "Dense layout for longer evidence-backed resumes.", accent: "#111827", density: "Dense" },
];

export const renderCvTemplates: ResumeTemplate[] = [
  { id: "classic", name: "Classic", description: "Traditional hierarchy with generous spacing.", accent: "#0f172a", density: "Comfortable" },
  { id: "moderncv", name: "ModernCV", description: "ModernCV-inspired hierarchy with a restrained accent.", accent: "#004f90", density: "Balanced" },
  { id: "engineeringresumes", name: "EngineeringResumes", description: "Dense engineering layout optimized for evidence.", accent: "#111827", density: "Dense" },
  { id: "engineeringclassic", name: "EngineeringClassic", description: "Traditional engineering resume structure.", accent: "#1f2937", density: "Balanced" },
  { id: "sb2nov", name: "SB2Nov", description: "Compact technical layout with strong section rules.", accent: "#000000", density: "Dense" },
  { id: "harvard", name: "Harvard", description: "Academic typography with clear chronology.", accent: "#7a0019", density: "Comfortable" },
  { id: "ember", name: "Ember", description: "Warm accent and compact professional rhythm.", accent: "#b45309", density: "Balanced" },
  { id: "ink", name: "Ink", description: "Minimal monochrome layout for print-first resumes.", accent: "#111111", density: "Balanced" },
  { id: "opal", name: "Opal", description: "Soft modern accent with spacious sections.", accent: "#0f766e", density: "Comfortable" },
];
