# Compact resume presentation

Scope: deterministic `resume-source/v1` injection and HTML/PDF/DOCX presentation; source schemas and verification rules remain unchanged.

- Keep measurable claims and measurement references separate in the source AST.
- Combine highlights within their owning record into one semicolon-separated bullet.
- Combine eligible claims only when their sorted sets of supporting verified evidence IDs match. Keep different runs separate; retain qualifiers, target filtering, and exclusion of unverified claims.
- Render Awards as one paragraph with semicolon-separated entries; retain issuer, date, summary, highlights, skills, and additional links.
- Attach the first record link to its title. Preserve title font/color and omit automatic hyperlink underline. Render additional links separately.
- Render project summary beside the title and align the date to the right. Wrap long headings and descriptions without losing title links.
- Use dummy links only in the synthetic sample; never invent links or dates for member exports.
- Reuse jsPDF link annotations and DOCX external hyperlinks/right tab stops; add no production dependencies.

Verification: complete frontend static/test passes, production Pages build/E2E, exported sample inspection, PDF hyperlink annotations, and packed DOCX hyperlink/tab/paragraph checks.
