import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { saveManualOpportunity } from "@pytorch-ph/domain-server/career-evidence";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const opportunity = await saveManualOpportunity(userId, { ...(body && typeof body === "object" ? body : {}), id });
    return NextResponse.json({ opportunity }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update opportunity." }, { status: 400 });
  }
}
