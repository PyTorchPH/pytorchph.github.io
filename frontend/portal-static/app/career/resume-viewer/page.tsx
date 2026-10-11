"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ResumePdfViewer } from "@pytorch-ph/domain-client/resumes";
import { resumeTemplateSchema } from "@pytorch-ph/domain-protocol/resumes";

export default function ResumeViewerPage() {
  return <Suspense fallback={<p role="status">Inihahanda ang PDF preview…</p>}><ResumePreview /></Suspense>;
}

function ResumePreview() {
  const params = useSearchParams();
  const template = resumeTemplateSchema.safeParse(params.get("template"));
  if (!template.success) return <p role="alert">Hindi valid ang resume template.</p>;
  return <ResumePdfViewer sample={params.get("sample") === "1"} template={template.data} />;
}
