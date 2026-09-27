---
logic_id: career-evidence.resume-injection
code_paths:
  - domains/protocol/career-evidence
  - domains/server/career-evidence
  - domains/server/resumes
  - domains/client/career-evidence
  - supabase/migrations
tests:
  - apps/portal/tests/resume-injection-contract.test.ts
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

The trusted server persists `evidenceKind` as `career_evidence_items.evidence_kind`. Supabase detail
projection returns it to the client. Resume injection accepts only `user_verified` evidence.

Acceptance tests prove that professional experience never appears under Projects, personal projects
never expose a position or enter Experience, and legacy evidence defaults to Projects.
