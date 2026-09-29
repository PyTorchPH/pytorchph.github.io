import { notFound } from "next/navigation";
import { ResumePdfViewer } from "@pytorch-ph/domain-client/resumes";
import { resumeTemplateSchema } from "@pytorch-ph/domain-protocol/resumes";

export default async function ResumeViewerPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const parsed = resumeTemplateSchema.safeParse((await searchParams).template);
  if (!parsed.success) notFound();
  return <ResumePdfViewer template={parsed.data} />;
}
