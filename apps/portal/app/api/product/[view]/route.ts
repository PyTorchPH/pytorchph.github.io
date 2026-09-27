import { NextResponse } from "next/server";
import { currentViewer, viewerMayUseOfficerPortal } from "@pytorch-ph/domain-server/identity";
import { isProductView } from "@pytorch-ph/domain-protocol/career-evidence";
import { developerDiagnostics, isOfficerOnlyProductView, memberSafeProductData } from "@pytorch-ph/domain-server/career-evidence";
import { productRepository } from "@pytorch-ph/domain-server/career-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ view: string }> }) {
  const { view } = await context.params;
  if (!isProductView(view)) return NextResponse.json({ error: "Unknown product view." }, { status: 404 });
  const viewer = await currentViewer();
  if (!viewer.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (viewer.audience === "officer" && !viewerMayUseOfficerPortal(viewer)) {
    return NextResponse.json({ error: "Officer portal access is required." }, { status: 403 });
  }
  if (isOfficerOnlyProductView(view) && !viewerMayUseOfficerPortal(viewer)) {
    return NextResponse.json({ error: "Officer portal access is required." }, { status: 403 });
  }
  try {
    const startedAt = performance.now();
    const payload = await productRepository().read(view, viewer.userId);
    const repositoryReadMs = performance.now() - startedAt;
    const responsePayload = viewer.audience === "member"
      ? memberSafeProductData(view, payload)
      : {
          ...payload,
          diagnostics: developerDiagnostics(view, payload, viewer, repositoryReadMs),
        };
    return NextResponse.json(responsePayload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Product data is unavailable." }, { status: 503 });
  }
}
