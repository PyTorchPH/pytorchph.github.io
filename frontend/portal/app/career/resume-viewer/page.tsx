import { notFound } from "next/navigation";
import { ResumePdfViewer } from "@pytorch-ph/domain-client/resumes";
import { resumeTemplateSchema } from "@pytorch-ph/domain-protocol/resumes";

export default async function ResumeViewerPage({ searchParams }: { searchParams: Promise<{ template?: string; sample?: string }> }) {
  const params = await searchParams;
  const parsed = resumeTemplateSchema.safeParse(params.template);
  if (!parsed.success) notFound();
  return <ResumePdfViewer sample={params.sample === "1"} template={parsed.data} />;
}
