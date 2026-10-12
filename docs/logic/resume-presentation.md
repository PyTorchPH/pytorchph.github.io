# Compact resume presentation

Scope: `portfolio-evidence/v2` YAML evidence, deterministic `resume-source/v1` YAML projection, RenderCV YAML, and browser PDF rendering.

`C:\Users\jbalb\Desktop\Projects\portfolio-evidence.yaml` is the canonical local evidence contract (`portfolio-evidence/v2`). `resume-source/v1` is its renderer-neutral, person-and-target projection. The deterministic injector remains the authority for evidence verification, target filtering, qualifiers, section order, and omission of unsupported quantitative claims.

`rendercv-adapter.ts` maps the validated `ResumeProfile` to the official RenderCV v2.8 YAML schema. `rendercv-typst.ts` maps the same profile to the vendored RenderCV v2.8 Typst template and compiles PDF in the browser with Typst WebAssembly. Python and the RenderCV CLI are compatibility oracles only; users do not need them. The existing jsPDF renderer remains the lightweight preview and page-fit path.

- Keep measurable claims and measurement references separate in the source AST.
- Combine highlights within their owning record into one semicolon-separated bullet.
- Combine eligible claims only when their sorted sets of supporting verified evidence IDs match. Keep different runs separate; retain qualifiers, target filtering, and exclusion of unverified claims.
- Render Awards as one paragraph with semicolon-separated entries; retain issuer, date, summary, highlights, skills, and additional links.
- Attach the first record link to its title. Preserve title font/color and omit automatic hyperlink underline. Render additional links separately.
- Render project summary beside the title and align the date to the right. Wrap long headings and descriptions without losing title links.
- Use dummy links only in the synthetic sample; never invent links or dates for member exports.
- Reuse jsPDF link annotations and DOCX external hyperlinks/right tab stops; add no production dependencies.

Verification: complete frontend static/test passes, production Pages build/E2E, exported sample inspection, PDF hyperlink annotations, and packed DOCX hyperlink/tab/paragraph checks.
