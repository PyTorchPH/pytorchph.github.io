---
logic_id: career-evidence.resume-injection
code_paths:
  - frontend/contracts/career-evidence
  - frontend/contracts/resumes
  - frontend/features/resumes
  - development/local-server/career-evidence
  - development/local-server/resumes
  - frontend/features/career-evidence
  - backend/legacy-python/resume_builder/core
  - backend/api/migrations
tests:
  - frontend/portal/tests/resume-injection-contract.test.ts
  - frontend/portal/tests/resume-evidence-contract.test.ts
feedback_events:
  - resume.injection_completed
  - resume.injection_stopped
  - resume.injection_failed
related_logic:
  - career-evidence.ingestion
---
# Resume Evidence Injection

Verified evidence is injected by its explicit `evidenceKind`: `experience` items enter only the
professional Experience section; `project` items enter only the Projects section. Missing or
unknown legacy kinds fail closed to `project` so a project cannot become employment implicitly.

`role` is a professional position. It is required with `organization` for `experience` and cleared
when a user saves an item as `project`. Project organization metadata MAY remain as source context,
but it MUST NOT create an Experience entry.

The trusted server persists `evidenceKind` as `career_evidence_items.evidence_kind`. Rust API detail
projection returns it to the client. Resume injection accepts only `user_verified` evidence.

Acceptance tests prove that professional experience never appears under Projects, personal projects
never expose a position or enter Experience, and legacy evidence defaults to Projects.

## Evidence-backed contract

Resume generation uses `evidence-backed-resume/v1`. Each entry owns its claims; each claim owns its
method, numeric results, source artifacts, verification, limitations, rendered wording, target roles,
and injection destinations. A quantitative claim is renderable only when its evidence is verified,
at least `controlled_measured`, contains numeric metrics, and is explicitly marked resume-eligible.

The frontend Zod parser and backend Pydantic adapter enforce the same gates. Both produce the legacy
`ResumeProfile` shape consumed by the existing HTML, DOCX, and PDF renderers. ISO/IEC 25010 and
ISO/IEC 25023 measurement labels classify evidence; they do not claim certification or replace
human review.

Evidence maturity and achievement level are separate. The browser may compute an advisory point
preview only after officer verification and an explicitly selected published rubric level. It cannot
approve a claim or append a point event; those remain Rust-backend responsibilities.

## Normalized extraction and rendering

The preferred `evidence-backed-resume/v2` draft is a normalized graph. Entries reference claim IDs;
claim-evidence links reference shared test records and their exact measurement IDs. Environment and
artifact records are stored once. Controlled ISO/IEC 25010 characteristic codes and test-type enums
let deterministic code select evidence for each target resume without interpreting prose.

The frontend AI prompt only extracts a draft. It records missing identity fields, omits absent
optional sections, and must not invent contacts or measurements. Deterministic promotion requires
name, email, phone, and location; validates every reference; excludes unverified quantitative
claims; applies target classification/test preferences; and then projects the graph into the legacy
`ResumeProfile`. Projects with no quantitative evidence remain valid. Empty optional sections are
omitted from HTML, DOCX, and PDF output. The embedded v1 contract remains supported for compatibility.
