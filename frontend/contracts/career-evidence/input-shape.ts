import { z } from "zod";

export const evidenceFormSchema = z.object({
  evidenceKind: z.enum(["project", "experience"]).optional(),
  title: z.string().trim().min(2, "Add a descriptive achievement title."),
  organization: z.string().trim(),
  role: z.string().trim(),
  dateLabel: z.string().trim().min(2, "Add the evidence date."),
  description: z.string().trim().min(10, "Describe the evidence in at least 10 characters."),
  skillsText: z.string().trim().min(1, "Add at least one evidenced skill."),
}).superRefine((value, context) => {
  if (value.evidenceKind !== "experience") return;
  if (value.organization.length < 2) context.addIssue({ code: "custom", path: ["organization"], message: "Add the employer or professional organization." });
  if (value.role.length < 2) context.addIssue({ code: "custom", path: ["role"], message: "Add your professional position." });
});

export type EvidenceFormValues = z.infer<typeof evidenceFormSchema>;
