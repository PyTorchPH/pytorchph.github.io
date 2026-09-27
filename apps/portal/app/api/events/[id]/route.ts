import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { eventAction } from "@pytorch-ph/domain-server/organization";
import { eventActionSchema } from "@pytorch-ph/domain-protocol/organization";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { const body = eventActionSchema.parse(await request.json()); return NextResponse.json(await eventAction(await currentViewer(), (await context.params).id, body), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { const message = error instanceof Error ? error.message : "Action failed"; const status = message.includes("Authentication") ? 401 : message.includes("authorization") || message.includes("department") ? 403 : message.includes("not found") ? 404 : message.includes("progress") || message.includes("changed") ? 409 : 422; return NextResponse.json({ error: message }, { status }); } }
