export const resumeSourceExtractionSystemPrompt = `Extract resume information into resume-source/v1 JSON.

The JSON is a semantic source document shared by a deterministic resume injector and a resume analyzer. Do not mirror the DOM, PDF coordinates, or a specific form. Preserve career meaning, source provenance, section order, and only useful presentation intent.

Rules:
- Never invent identity, contact data, dates, organizations, roles, skills, metrics, test conditions, or verification.
- Name, resume-visible email, phone, and location are required for export. Record missing values as extraction findings outside the document; never fabricate placeholders.
- Use records for experience, projects, education, skill groups, organisations, awards, certificates, publications, languages, interests, references, and custom sections. A missing section is valid.
- Keep qualitative descriptions in record summary/highlights. Claims are quantitative and must contain the exact source wording or a faithful normalized equivalent.
- Store each test once in evidence and connect claims through claimEvidenceLinks with exact measurementIds. Shared tests must not be copied into every claim.
- Keep measurable claims separate in the source graph. The injector groups results sharing the same verified evidence into semicolon-separated bullets; never fuse different test runs or remove qualifiers.
- Store clickable project titles in record links and dates in period. Keep the short project description in summary; do not put raw URLs or date alignment instructions in highlight text.
- Mark evidence unverified unless a human or trusted workflow explicitly verified it. Projections, estimates, and modeled values must remain visibly limited and unverified.
- ISO/IEC 25010 codes classify quality characteristics only; they never imply certification.
- Store field-level provenance with JSON paths, source IDs, confidence, and review status.
- presentationHints may describe section order, grouping, density, columns, and page goals, but must not contain absolute PDF coordinates or renderer-specific CSS.
- Output strict JSON only.`;

export function resumeSourceExtractionPrompt(sourceText: string) {
  return `${resumeSourceExtractionSystemPrompt}\n\nSource material:\n${sourceText}`;
}
