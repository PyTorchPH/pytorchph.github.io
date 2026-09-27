import { createSupabaseServerClient } from "@pytorch-ph/domain-server/identity";

type EvidenceInput = { title: string; description: string; skills: string[]; imageDataUrl: string };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changes", "warnings"],
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["field", "before", "after"],
        properties: { field: { type: "string" }, before: { type: "string" }, after: { type: "string" } },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
};

export async function resolveSupabaseEvidenceInput(evidenceId: string): Promise<EvidenceInput> {
  const client = await createSupabaseServerClient();
  const { data: item, error: itemError } = await client.from("career_evidence_items").select("id,title,description,skill_tags").eq("id", evidenceId).single();
  if (itemError || !item) throw new Error("Evidence item is unavailable or not owned by the current user.");
  const { data: media, error: mediaError } = await client.from("career_evidence_media").select("storage_path,exif_stripped").eq("evidence_item_id", evidenceId).eq("media_type", "photo").limit(1).single();
  if (mediaError || !media) throw new Error("Select a private evidence photo before requesting AI analysis.");
  if (!media.exif_stripped) throw new Error("The selected photo must have EXIF stripped before AI analysis.");
  const { data: blob, error: downloadError } = await client.storage.from("career-evidence-media").download(media.storage_path);
  if (downloadError || !blob) throw new Error("The selected private photo could not be read.");
  if (blob.size > 10 * 1024 * 1024) throw new Error("Evidence photos sent for analysis must be 10 MB or smaller.");
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(blob.type)) throw new Error("Evidence analysis supports JPEG, PNG, or WebP photos.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  return {
    title: item.title,
    description: item.description,
    skills: Array.isArray(item.skill_tags) ? item.skill_tags.filter((value): value is string => typeof value === "string") : [],
    imageDataUrl: `data:${blob.type};base64,${bytes.toString("base64")}`,
  };
}

export async function requestEvidenceProposal(input: EvidenceInput) {
  const apiUrl = process.env.PYTORCH_PH_AI_API_URL?.trim();
  const model = process.env.PYTORCH_PH_AI_MODEL?.trim();
  if (!apiUrl || !model) throw new Error("The provider-neutral AI HTTP endpoint is not configured.");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.PYTORCH_PH_AI_API_KEY ? { Authorization: `Bearer ${process.env.PYTORCH_PH_AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: "Extract only evidence-grounded career achievements. Never invent, estimate, alter, or extrapolate metrics. Return a concise field-level proposal; the user is the verification authority." }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify({ title: input.title, description: input.description, skills: input.skills }) }, { type: "input_image", image_url: input.imageDataUrl }] },
      ],
      text: { format: { type: "json_schema", name: "career_evidence_proposal", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Configured AI provider returned ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  return parseEvidenceProposalResponse(payload);
}

export function parseEvidenceProposalResponse(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const outputText = typeof payload.output_text === "string"
    ? payload.output_text
    : output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
      .map((content) => content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string" ? String((content as { text: string }).text) : "")
      .find(Boolean) || "";
  if (!outputText) throw new Error("Configured AI provider returned no strict JSON output.");
  const proposal = JSON.parse(outputText) as { summary?: unknown; changes?: unknown; warnings?: unknown };
  if (typeof proposal.summary !== "string" || !Array.isArray(proposal.changes) || !Array.isArray(proposal.warnings)) throw new Error("Configured AI provider returned an invalid proposal.");
  if (!proposal.changes.every((change) => change && typeof change === "object" && ["field", "before", "after"].every((key) => typeof (change as Record<string, unknown>)[key] === "string"))) throw new Error("Configured AI provider returned invalid field changes.");
  if (!proposal.warnings.every((warning) => typeof warning === "string")) throw new Error("Configured AI provider returned invalid warnings.");
  return proposal;
}
