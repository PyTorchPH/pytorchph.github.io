export type ResumeTemplateId = "classic" | "modern" | "compact";

export const resumeTemplates: Array<{
  id: ResumeTemplateId;
  name: string;
  description: string;
  accent: string;
  density: string;
}> = [
  { id: "classic", name: "Classic", description: "Traditional hierarchy with generous spacing.", accent: "#0f172a", density: "Comfortable" },
  { id: "modern", name: "Modern", description: "Crisp section rules and a restrained accent.", accent: "#e8590c", density: "Balanced" },
  { id: "compact", name: "Compact", description: "Tighter rhythm for evidence-rich one-page resumes.", accent: "#2563eb", density: "Dense" },
];
