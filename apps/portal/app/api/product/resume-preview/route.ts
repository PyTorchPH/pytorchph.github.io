import { NextRequest, NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { productRepository } from "@pytorch-ph/domain-server/career-evidence";
import { resumePdfBytes } from "@pytorch-ph/domain-server/resumes";
import { resumePreviewQuerySchema } from "@pytorch-ph/domain-protocol/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsed = resumePreviewQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Select a supported resume template." }, { status: 400 });
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const data = await productRepository().read("resumes", userId);
  if (!data.resumeProfile) return NextResponse.json({ error: "No verified resume snapshot is available." }, { status: 404 });
  const bytes = await resumePdfBytes(data.resumeProfile, parsed.data.template);
  const demoPrefix = data.meta.mode === "local_demo" ? "DEMO-" : "";
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${parsed.data.disposition}; filename="${demoPrefix}${parsed.data.template}-resume.pdf"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
