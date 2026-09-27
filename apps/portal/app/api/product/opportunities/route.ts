import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { saveManualOpportunity } from "@pytorch-ph/domain-server/career-evidence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const opportunity = await saveManualOpportunity(userId, await request.json().catch(() => ({})));
    return NextResponse.json({ opportunity }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create opportunity." }, { status: 400 });
  }
}
