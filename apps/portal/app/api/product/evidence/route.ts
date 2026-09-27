import { NextResponse } from "next/server";
import sharp from "sharp";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { attachEvidenceMedia, createEvidence } from "@pytorch-ph/domain-server/career-evidence";
import { validatedEvidenceItem } from "@pytorch-ph/domain-protocol/career-evidence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Select an evidence photo." }, { status: 400 });
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return NextResponse.json({ error: "Evidence photos must be JPEG, PNG, or WebP." }, { status: 415 });
      if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Evidence photos must be 10 MB or smaller." }, { status: 413 });
      const cleanBytes = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      const title = String(form.get("title") || file.name.replace(/\.[^.]+$/, "") || "Uploaded evidence");
      const item = await createEvidence(userId, validatedEvidenceItem({
        sourceId: "upload",
        title,
        organization: "",
        role: "",
        dateLabel: new Date().toLocaleDateString("en", { month: "long", year: "numeric" }),
        description: "",
        quantitative: [],
        qualitative: [],
        skills: [],
        mediaUrl: "/demo/evidence/manual-placeholder.svg",
        mediaAlt: `User-selected evidence photo: ${title}`,
        verificationState: "draft",
      }));
      const saved = await attachEvidenceMedia(userId, item, cleanBytes, "image/webp");
      return NextResponse.json({ item: saved, metadataStripped: true }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    const body = await request.json().catch(() => ({})) as { item?: unknown; approve?: boolean };
    const submitted = body.item && typeof body.item === "object" ? body.item as Record<string, unknown> : {};
    const { id: _ignored, ...input } = validatedEvidenceItem({ ...submitted, sourceId: "manual" }, { approve: body.approve === true });
    const item = await createEvidence(userId, input);
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create evidence." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
