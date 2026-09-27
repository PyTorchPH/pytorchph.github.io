import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { updateFeedbackReport } from "@pytorch-ph/domain-server/privacy-feedback";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  try {
    return NextResponse.json(await updateFeedbackReport(viewer, (await context.params).id, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report update failed.";
    return NextResponse.json({ error: message }, { status: message.includes("authorization") ? 403 : 400 });
  }
}
