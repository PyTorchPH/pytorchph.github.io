import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { readMemberOverview } from "@pytorch-ph/domain-server/leaderboards";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return NextResponse.json(await readMemberOverview(userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Member overview unavailable." }, { status: 503 });
  }
}
