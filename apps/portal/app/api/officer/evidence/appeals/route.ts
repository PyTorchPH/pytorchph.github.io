import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { readOfficerEvidenceAppeals } from "@pytorch-ph/domain-server/organization";

export async function GET() {
  try { return NextResponse.json(await readOfficerEvidenceAppeals(await currentViewer()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Appeals unavailable." }, { status: 403 }); }
}
