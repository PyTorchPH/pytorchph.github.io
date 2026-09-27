import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { resolveEvidenceAppeal } from "@pytorch-ph/domain-server/organization";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await resolveEvidenceAppeal(await currentViewer(), (await context.params).id, await request.json())); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Appeal resolution failed." }, { status: 422 }); }
}
