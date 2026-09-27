import { NextResponse } from "next/server";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { createOperationalEvent } from "@pytorch-ph/domain-server/privacy-feedback";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createOperationalEvent(await currentViewer(), await request.json()), { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operational event rejected.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 422 });
  }
}
