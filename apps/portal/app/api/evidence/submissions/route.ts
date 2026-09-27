import { NextResponse } from "next/server";
import { submitEvidenceEnvelope } from "@pytorch-ph/domain-server/career-evidence";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";

export async function POST(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return NextResponse.json(await submitEvidenceEnvelope(userId, await request.json()), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evidence submission failed.";
    return NextResponse.json({ error: message }, { status: message.includes("duplicate") ? 409 : 422 });
  }
}
