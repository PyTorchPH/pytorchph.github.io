import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { updateEvidence } from "@pytorch-ph/domain-server/career-evidence";
import { validatedEvidenceItem } from "@pytorch-ph/domain-protocol/career-evidence";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { item?: unknown; approve?: boolean };
    const item = validatedEvidenceItem(body.item, { id, approve: body.approve === true });
    const saved = await updateEvidence(userId, item);
    return NextResponse.json({ item: saved }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update evidence." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
