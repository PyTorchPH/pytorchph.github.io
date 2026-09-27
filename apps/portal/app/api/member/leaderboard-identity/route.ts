import { NextRequest, NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { readIdentitySettings, saveIdentitySettings, usernameAvailable } from "@pytorch-ph/domain-server/leaderboards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const candidate = request.nextUrl.searchParams.get("username");
    if (candidate !== null) return NextResponse.json({ available: await usernameAvailable(userId, candidate) }, { headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json(await readIdentitySettings(userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Identity settings unavailable." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return NextResponse.json(await saveIdentitySettings(userId, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Identity settings could not be saved." }, { status: 400 });
  }
}
