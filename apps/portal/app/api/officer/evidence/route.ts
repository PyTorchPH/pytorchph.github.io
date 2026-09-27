import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { readEvidenceClaims } from "@pytorch-ph/domain-server/organization";
export async function GET() { try { return NextResponse.json(await readEvidenceClaims(await currentViewer())); } catch (error) { const message = error instanceof Error ? error.message : "Unavailable"; return NextResponse.json({ error: message }, { status: message.includes("authorization") ? 403 : 503 }); } }
