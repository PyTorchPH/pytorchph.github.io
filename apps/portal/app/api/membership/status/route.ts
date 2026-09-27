import { NextRequest, NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { readMembershipStatus } from "@pytorch-ph/domain-server/privacy-feedback";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const forcePending = request.nextUrl.searchParams.get("demo") === "pending";
    return NextResponse.json(await readMembershipStatus(viewer, forcePending), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Membership status unavailable." }, { status: 503 });
  }
}
