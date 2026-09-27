import type { ProductRepository, ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { unavailableDashboardAnalytics } from "@pytorch-ph/domain-protocol/career-evidence";
import { createSupabaseServerClient } from "@pytorch-ph/domain-server/identity";
import { resumeProfileFromEvidence } from "@pytorch-ph/domain-server/resumes";

export class SupabaseProductRepository implements ProductRepository {
  readonly provider = "supabase" as const;

  async read(view: ProductView, userId: string): Promise<ProductViewData> {
    const client = await createSupabaseServerClient();
    const [{ data, error }, { data: detail }, { data: member }, { data: auth }, { data: opportunities }] = await Promise.all([
      client.rpc("product_view", { requested_view: view, requested_user_id: userId }),
      client.rpc("career_evidence_detail", { requested_user_id: userId }),
      client.from("member_profiles").select("display_name").eq("id", userId).single(),
      client.auth.getUser(),
      client.from("market_opportunities").select("id,company,job_title,location,work_mode,funnel_stage,fit_score,record_origin").eq("user_id", userId).order("updated_at", { ascending: false }),
    ]);
    if (error) throw new Error(`Supabase product view failed: ${error.message}`);
    if (!data || typeof data !== "object") throw new Error("Supabase product view returned no data.");
    const payload = data as unknown as ProductViewData;
    const detailPayload = detail && typeof detail === "object" ? detail as { items?: Array<Record<string, unknown>>; sources?: NonNullable<ProductViewData["evidence"]>["sources"] } : {};
    const items = await Promise.all((detailPayload.items || []).map(async (item) => {
      const mediaPath = typeof item.mediaPath === "string" ? item.mediaPath : "";
      if (!mediaPath) return item;
      const { data: signed } = await client.storage.from("career-evidence-media").createSignedUrl(mediaPath, 60 * 10);
      return { ...item, mediaUrl: signed?.signedUrl || "" };
    }));
    const typedItems = items as NonNullable<ProductViewData["evidence"]>["items"];
    const resumeProfile = resumeProfileFromEvidence(typedItems || [], { fullName: member?.display_name || "Career profile", email: auth.user?.email || "" });
    return {
      ...payload,
      evidence: payload.evidence ? { ...payload.evidence, items: typedItems, sources: detailPayload.sources || payload.evidence.sources } : payload.evidence,
      resumeProfile,
      opportunities: (opportunities || []).map((item) => ({ id: item.id, company: item.company, title: item.job_title, location: item.location, workMode: item.work_mode, stage: item.funnel_stage, fit: item.fit_score, recordOrigin: item.record_origin })),
      meta: { source: "live", provider: "supabase", mode: "production", synthetic: false, generatedAt: new Date().toISOString(), label: "Live Supabase data" },
      analytics: payload.analytics || unavailableDashboardAnalytics(),
    };
  }
}
