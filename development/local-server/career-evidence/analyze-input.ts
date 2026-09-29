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
