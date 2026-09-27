import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { openEvidenceAppeal, readMemberEvidenceIntegrity } from "@pytorch-ph/domain-server/organization";

export async function GET() {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { return NextResponse.json(await readMemberEvidenceIntegrity(userId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integrity status unavailable." }, { status: 422 }); }
}

export async function POST(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { return NextResponse.json(await openEvidenceAppeal(userId, await request.json()), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Appeal could not be opened." }, { status: 422 }); }
}
