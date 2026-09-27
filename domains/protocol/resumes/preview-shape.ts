import { z } from "zod";

export const resumeTemplateSchema = z.enum(["classic", "modern", "compact"]);
export const resumePreviewQuerySchema = z.object({
  template: resumeTemplateSchema,
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});
