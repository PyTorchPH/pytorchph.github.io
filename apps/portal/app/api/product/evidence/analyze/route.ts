import { NextResponse } from "next/server";
import { currentProductUserId } from "@pytorch-ph/domain-server/identity";
import { requestEvidenceProposal, resolveSupabaseEvidenceInput } from "@pytorch-ph/domain-server/career-evidence";
import { saveEvidenceProposal } from "@pytorch-ph/domain-server/career-evidence";
import { configuredProductProvider } from "@pytorch-ph/domain-server/career-evidence";

type AnalyzeRequest = {
  consent?: boolean;
  evidenceId?: string;
  current?: { title?: string; description?: string; skills?: string[] };
};

export async function POST(request: Request) {
  const userId = await currentProductUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as AnalyzeRequest;
  if (body.consent !== true) return NextResponse.json({ error: "Explicit per-analysis consent is required." }, { status: 400 });
  if (!body.evidenceId || !body.current?.title) return NextResponse.json({ error: "A selected evidence item is required." }, { status: 400 });

  if (configuredProductProvider() === "local" && process.env.NODE_ENV !== "production") {
    return NextResponse.json({
      proposal: {
        summary: "The selected evidence supports a concise achievement statement. Metrics remain unchanged unless present in the source.",
        changes: [{ field: "Description", before: body.current.description || "", after: body.current.description || "Describe the demonstrated outcome without adding unsupported metrics." }],
        warnings: ["Synthetic demo analysis only; no external provider or real media was contacted."],
      },
      provider: "demo-fixture",
      userApprovalRequired: true,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if ((process.env.PYTORCH_PH_DATA_PROVIDER || "local") !== "supabase") {
    return NextResponse.json({ error: "Live media resolution is not available for the active provider. No data was sent.", code: "AI_MEDIA_RESOLVER_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    const input = await resolveSupabaseEvidenceInput(body.evidenceId);
    const proposal = await requestEvidenceProposal(input);
    await saveEvidenceProposal(userId, body.evidenceId, proposal, "configured-http");
    return NextResponse.json({ proposal, provider: "configured-http", userApprovalRequired: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence analysis failed. No changes were applied." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
