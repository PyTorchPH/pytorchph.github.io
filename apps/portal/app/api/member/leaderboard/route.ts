import { NextRequest, NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { readLeaderboard } from "@pytorch-ph/domain-server/leaderboards";
import { leaderboardViewSchema } from "@pytorch-ph/domain-protocol/leaderboards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const page = Number(request.nextUrl.searchParams.get("page") || 1);
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 25);
  const view = leaderboardViewSchema.safeParse(request.nextUrl.searchParams.get("view") || "both");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return NextResponse.json({ error: "Invalid pagination." }, { status: 400 });
  if (!view.success) return NextResponse.json({ error: "Invalid leaderboard view." }, { status: 400 });
  try {
    const data = await readLeaderboard(userId, { season: request.nextUrl.searchParams.get("season"), skill: request.nextUrl.searchParams.get("skill"), view: view.data, page, pageSize });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Leaderboard unavailable." }, { status: 503 });
  }
}
