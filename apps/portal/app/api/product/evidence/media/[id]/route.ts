import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { configuredProductProvider } from "@pytorch-ph/domain-server/career-evidence";
import { readLocalMedia } from "@pytorch-ph/domain-server/career-evidence";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (configuredProductProvider() !== "local") return NextResponse.json({ error: "Local media route is unavailable." }, { status: 404 });
  const { id } = await context.params;
  const media = readLocalMedia(userId, id);
  if (!media) return NextResponse.json({ error: "Evidence media not found." }, { status: 404 });
  return new Response(media.bytes as BodyInit, { headers: { "Content-Type": media.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
