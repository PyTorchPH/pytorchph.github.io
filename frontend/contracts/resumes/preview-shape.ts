import { z } from "zod";

export const resumeTemplateSchema = z.enum(["classic", "moderncv", "engineeringresumes", "engineeringclassic", "sb2nov", "harvard", "ember", "ink", "opal", "modern", "compact"]);
export const resumePreviewQuerySchema = z.object({
  template: resumeTemplateSchema,
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});
