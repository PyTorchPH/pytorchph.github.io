import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { addFeedbackNote } from "@pytorch-ph/domain-server/privacy-feedback";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const payload = await request.json() as { body?: unknown };
    return NextResponse.json(await addFeedbackNote(await currentViewer(), (await context.params).id, payload.body), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Note could not be added.";
    return NextResponse.json({ error: message }, { status: message.includes("authorization") ? 403 : 400 });
  }
}
