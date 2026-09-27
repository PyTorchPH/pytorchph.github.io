import { randomUUID } from "node:crypto";
import { manualOpportunitySchema, type EvidenceItem, type EvidenceSource, type Opportunity } from "@pytorch-ph/domain-protocol/career-evidence";
import { configuredProductProvider } from "./select-repository";
import { createLocalEvidence, listLocalOpportunities, saveLocalEvidence, saveLocalMedia, saveLocalOpportunity, saveLocalSourceState } from "./store-local";
import { supportedSourceById } from "./read-source";
import { createSupabaseAdminClient } from "@pytorch-ph/domain-server/identity";

export type EvidenceCreateInput = Omit<EvidenceItem, "id">;
export type SourceAction = "connect" | "sync" | "disconnect";

export async function saveManualOpportunity(userId: string, input: unknown): Promise<Opportunity> {
  const value = manualOpportunitySchema.parse(input);
  const id = value.id || randomUUID();
  const opportunity: Opportunity = { ...value, id, recordOrigin: "manual" };
  if (configuredProductProvider() === "local") {
    if (value.id && !listLocalOpportunities(userId).some((item) => item.id === value.id)) throw new Error("Manual opportunity is unavailable or not owned by the current user.");
    return saveLocalOpportunity(userId, opportunity);
  }
  const client = createSupabaseAdminClient();
  if (value.id) {
    const { data: existing, error: readError } = await client.from("market_opportunities").select("id,company,job_title,location,work_mode,funnel_stage,fit_score,record_origin").eq("id", id).eq("user_id", userId).single();
    if (readError || !existing || existing.record_origin !== "manual") throw new Error("Manual opportunity is unavailable or not owned by the current user.");
    const { error } = await client.from("market_opportunities").update({ company: value.company, job_title: value.title, location: value.location, work_mode: value.workMode, funnel_stage: value.stage, fit_score: value.fit }).eq("id", id).eq("user_id", userId).eq("record_origin", "manual");
    if (error) throw new Error(`Could not update opportunity: ${error.message}`);
    const { error: revisionError } = await client.from("market_opportunity_revisions").insert({ user_id: userId, opportunity_id: id, mutation_origin: "manual", snapshot: { before: existing, after: opportunity } });
    if (revisionError) throw new Error(`Opportunity updated but provenance history failed: ${revisionError.message}`);
  } else {
    const { error } = await client.from("market_opportunities").insert({ id, user_id: userId, company: value.company, job_title: value.title, location: value.location, work_mode: value.workMode, funnel_stage: value.stage, fit_score: value.fit, record_origin: "manual" });
    if (error) throw new Error(`Could not create opportunity: ${error.message}`);
    const { error: revisionError } = await client.from("market_opportunity_revisions").insert({ user_id: userId, opportunity_id: id, mutation_origin: "manual", snapshot: { action: "created", after: opportunity } });
    if (revisionError) throw new Error(`Opportunity created but provenance history failed: ${revisionError.message}`);
  }
  return opportunity;
}

const sourceKind: Record<string, "project" | "post" | "document" | "manual"> = {
  github: "project",
  linkedin: "post",
  facebook: "post",
  twitter: "post",
  instagram: "post",
  website: "project",
  upload: "document",
  manual: "manual",
};

async function supabaseSourceId(userId: string, providerKey: string): Promise<string | null> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("career_evidence_sources").select("id").eq("user_id", userId).eq("provider_key", providerKey).maybeSingle();
  if (error) throw new Error(`Could not resolve evidence source: ${error.message}`);
  return data?.id || null;
}

export async function createEvidence(userId: string, input: EvidenceCreateInput): Promise<EvidenceItem> {
  const collectionOrigin = input.sourceId === "manual" ? "manual" as const : input.sourceId === "upload" ? "upload" as const : "automated_scrape" as const;
  const taggedInput = { ...input, collectionOrigin };
  if (configuredProductProvider() === "local") return createLocalEvidence(userId, taggedInput);
  const client = createSupabaseAdminClient();
  const id = randomUUID();
  const sourceId = await supabaseSourceId(userId, input.sourceId);
  const { error } = await client.from("career_evidence_items").insert({
    id,
    user_id: userId,
    source_id: sourceId,
    evidence_kind: input.evidenceKind || "project",
    label: input.title,
    normalized_value: input.description,
    is_verified: input.verificationState === "user_verified",
    title: input.title,
    organization: input.organization,
    role_label: input.role,
    date_label: input.dateLabel,
    description: input.description,
    quantitative_results: input.quantitative,
    qualitative_results: input.qualitative,
    skill_tags: input.skills,
    review_state: input.verificationState,
    confidence: input.confidence || null,
    source_url: input.sourceUrl || null,
    collection_origin: collectionOrigin,
  });
  if (error) throw new Error(`Could not create evidence: ${error.message}`);
  const { error: revisionError } = await client.from("career_evidence_revisions").insert({
    user_id: userId,
    evidence_item_id: id,
    actor: "user",
    mutation_origin: "manual",
    snapshot: { action: "created", collectionOrigin },
  });
  if (revisionError) throw new Error(`Evidence created but provenance history failed: ${revisionError.message}`);
  return { ...taggedInput, id };
}

export async function updateEvidence(userId: string, item: EvidenceItem): Promise<EvidenceItem> {
  if (configuredProductProvider() === "local") return saveLocalEvidence(userId, item);
  const client = createSupabaseAdminClient();
  const { data: existing, error: readError } = await client.from("career_evidence_items").select("id,title,description,skill_tags,review_state").eq("id", item.id).eq("user_id", userId).single();
  if (readError || !existing) throw new Error("Evidence item is unavailable or not owned by the current user.");
  const { error } = await client.from("career_evidence_items").update({
    label: item.title,
    normalized_value: item.description,
    evidence_kind: item.evidenceKind || "project",
    is_verified: item.verificationState === "user_verified",
    title: item.title,
    organization: item.organization,
    role_label: item.role,
    date_label: item.dateLabel,
    description: item.description,
    quantitative_results: item.quantitative,
    qualitative_results: item.qualitative,
    skill_tags: item.skills,
    review_state: item.verificationState,
    confidence: item.confidence || null,
    source_url: item.sourceUrl || null,
  }).eq("id", item.id).eq("user_id", userId);
  if (error) throw new Error(`Could not update evidence: ${error.message}`);
  const { error: revisionError } = await client.from("career_evidence_revisions").insert({
    user_id: userId,
    evidence_item_id: item.id,
    actor: "user",
    mutation_origin: "manual",
    snapshot: { before: existing, after: item },
  });
  if (revisionError) throw new Error(`Evidence updated but revision history failed: ${revisionError.message}`);
  if (item.verificationState === "user_verified") {
    const { error: proposalError } = await client.from("career_evidence_ai_proposals").update({ state: "applied", user_approved_at: new Date().toISOString() }).eq("evidence_item_id", item.id).eq("user_id", userId).eq("state", "pending");
    if (proposalError) throw new Error(`Evidence updated but proposal status failed: ${proposalError.message}`);
  }
  return item;
}

export async function attachEvidenceMedia(userId: string, item: EvidenceItem, bytes: Uint8Array, mimeType: string): Promise<EvidenceItem> {
  if (configuredProductProvider() === "local") {
    saveLocalMedia(userId, item.id, bytes, mimeType);
    return saveLocalEvidence(userId, { ...item, mediaUrl: `/api/product/evidence/media/${item.id}` });
  }
  const client = createSupabaseAdminClient();
  const storagePath = `${userId}/${item.id}/${randomUUID()}.webp`;
  const { error: uploadError } = await client.storage.from("career-evidence-media").upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw new Error(`Could not store evidence media: ${uploadError.message}`);
  const { error: mediaError } = await client.from("career_evidence_media").insert({
    user_id: userId,
    evidence_item_id: item.id,
    storage_path: storagePath,
    alt_text: item.mediaAlt,
    media_type: "photo",
    exif_stripped: true,
  });
  if (mediaError) {
    await client.storage.from("career-evidence-media").remove([storagePath]);
    throw new Error(`Could not register evidence media: ${mediaError.message}`);
  }
  const { data: signed } = await client.storage.from("career-evidence-media").createSignedUrl(storagePath, 60 * 10);
  return { ...item, mediaUrl: signed?.signedUrl || item.mediaUrl };
}

export async function applySourceAction(
  userId: string,
  sourceId: string,
  action: SourceAction,
  options: { confirmation?: boolean; url?: string } = {}
): Promise<EvidenceSource> {
  const source = supportedSourceById(sourceId);
  if (!source) throw new Error("Unsupported evidence source.");
  const localDemo = configuredProductProvider() === "local" && process.env.NODE_ENV !== "production";
  if (localDemo) {
    if (source.connectionMethod === "url" && action === "connect") {
      try {
        const url = new URL(options.url || "");
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
      } catch {
        throw new Error("Enter a valid http or https portfolio URL.");
      }
    }
    if (action === "disconnect" && options.confirmation !== true) throw new Error("Disconnect requires explicit confirmation.");
    const connectionStatus = action === "disconnect" ? "disconnected" as const : "connected" as const;
    const result: EvidenceSource = {
      ...source,
      connectionStatus,
      status: connectionStatus === "connected" ? "verified" : "ready",
      description: `Synthetic local simulation. ${source.description || ""}`,
      lastSyncedAt: action === "sync" ? new Date().toISOString() : source.lastSyncedAt || null,
      configuredUrl: source.connectionMethod === "url" && action === "connect" ? options.url || null : source.configuredUrl || null,
    };
    saveLocalSourceState(userId, { id: sourceId, connectionStatus, lastSyncedAt: result.lastSyncedAt, configuredUrl: result.configuredUrl });
    return result;
  }
  if (source.connectionMethod === "website_session" && action === "connect") {
    const error = new Error("Open a normal visible browser and complete login or verification. The system will not create or bypass a session.");
    error.name = "HumanHandoffRequired";
    throw error;
  }
  if (action === "sync") {
    const error = new Error(source.connectionMethod === "website_session"
      ? "A verified visible browser session and its deterministic source adapter must complete collection before sync can be recorded."
      : "No deterministic collection adapter is configured for this source. No sync timestamp was written.");
    error.name = source.connectionMethod === "website_session" ? "HumanHandoffRequired" : "SourceAdapterUnavailable";
    throw error;
  }
  if (source.connectionMethod === "url" && action === "connect") {
    try {
      const url = new URL(options.url || "");
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    } catch {
      throw new Error("Enter a valid http or https portfolio URL.");
    }
  }
  if (action === "disconnect" && options.confirmation !== true) throw new Error("Disconnect requires explicit confirmation.");
  const connectionStatus = action === "disconnect" ? "disconnected" as const : "connected" as const;
  const result: EvidenceSource = {
    ...source,
    connectionStatus,
    status: connectionStatus === "connected" ? "verified" : "ready",
    lastSyncedAt: source.lastSyncedAt || null,
    configuredUrl: source.connectionMethod === "url" && action === "connect" ? options.url || null : source.configuredUrl || null,
  };
  if (configuredProductProvider() === "local") {
    saveLocalSourceState(userId, { id: sourceId, connectionStatus, lastSyncedAt: result.lastSyncedAt, configuredUrl: result.configuredUrl });
    return result;
  }
  const client = createSupabaseAdminClient();
  const { error } = await client.from("career_evidence_sources").upsert({
    user_id: userId,
    provider_key: sourceId,
    label: source.label,
    source_kind: sourceKind[sourceId] || "manual",
    verification_state: connectionStatus === "connected" ? "verified" : "ready",
    connection_state: connectionStatus,
    maturity: source.maturity || "available",
    connection_method: source.connectionMethod || "manual",
    description: source.description || "",
    permissions: source.permissions || [],
    last_synced_at: result.lastSyncedAt,
    configured_url: result.configuredUrl,
  }, { onConflict: "user_id,provider_key" });
  if (error) throw new Error(`Could not update source state: ${error.message}`);
  return result;
}

export async function saveEvidenceProposal(userId: string, evidenceId: string, proposal: unknown, providerLabel: string) {
  if (configuredProductProvider() === "local") return;
  const client = createSupabaseAdminClient();
  const { error } = await client.from("career_evidence_ai_proposals").insert({
    user_id: userId,
    evidence_item_id: evidenceId,
    provider_label: providerLabel,
    proposal,
    state: "pending",
  });
  if (error) throw new Error(`Could not save AI proposal: ${error.message}`);
}
