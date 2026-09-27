import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { applySourceAction, type SourceAction } from "@pytorch-ph/domain-server/career-evidence";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: SourceAction; confirmation?: boolean; url?: string };
  if (!body.action || !new Set(["connect", "sync", "disconnect"]).has(body.action)) return NextResponse.json({ error: "Unsupported source action." }, { status: 400 });
  try {
    const source = await applySourceAction(userId, id, body.action, { confirmation: body.confirmation, url: body.url });
    return NextResponse.json({ source }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const handoff = error instanceof Error && error.name === "HumanHandoffRequired";
    return NextResponse.json({ error: error instanceof Error ? error.message : "Source action failed.", code: handoff ? "HUMAN_HANDOFF_REQUIRED" : "SOURCE_ACTION_FAILED" }, { status: handoff ? 409 : 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
