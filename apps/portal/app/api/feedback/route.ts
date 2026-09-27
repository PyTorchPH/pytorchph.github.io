import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { createFeedbackReport, readFeedbackReportPage, readFeedbackReports } from "@pytorch-ph/domain-server/privacy-feedback";
import type { FeedbackReport } from "@pytorch-ph/domain-protocol/privacy-feedback";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await currentViewer();
  if (!viewer.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("paginated") === "1") {
      const value = <T extends string>(key: string) => params.get(key) as T | null;
      return NextResponse.json(await readFeedbackReportPage(viewer, {
        status: value<FeedbackReport["status"]>("status") || undefined,
        severity: value<FeedbackReport["severity"]>("severity") || undefined,
        portal: value<FeedbackReport["portal"]>("portal") || undefined,
        category: value<FeedbackReport["category"]>("category") || undefined,
        search: params.get("search") || undefined,
        cursor: params.get("cursor") || undefined,
        limit: Number(params.get("limit") || 25),
      }), { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(await readFeedbackReports(viewer), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reports unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const viewer = await currentViewer();
  try {
    const report = await createFeedbackReport(viewer, await request.json());
    return NextResponse.json({ id: report.id, status: report.status }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report could not be accepted.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
