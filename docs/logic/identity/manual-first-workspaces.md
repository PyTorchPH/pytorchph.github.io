---
logic_id: identity.manual-first-workspaces
code_paths:
  - domains/protocol/identity
  - domains/client/navigation
  - domains/client/career-evidence
  - apps/portal/app/api/capabilities
tests:
  - apps/portal/tests/capabilities.test.ts
  - apps/portal/tests/product-gateway.test.ts
feedback_events:
  - workspace.manual_available
  - workspace.automation_locked
related_logic:
  - career-evidence.ingestion
  - client-automation.evidence-extension
---
# Manual-first Career Workspaces

Authentication and normal audience authorization decide whether a person may enter Career Evidence,
Resume Studio, and Opportunities. Empty data, an unconfigured model, or a missing browser session
must not lock a workspace that still has a manual or read-only workflow.

Route capabilities and automation capabilities are separate. `evidence_read`, `resume_read`, and
`opportunities_read` keep the three workspaces reachable for an authenticated owner. Manual Career
Evidence edits use `evidence_write`. `evidence_scrape`, `resume_generate`, and `job_discovery` remain
locked independently until their AI, normalized-data, extension, and verified-session prerequisites
are satisfied. A locked automated action must explain its missing prerequisites inside the open
workspace; it must never turn the workspace navigation item into a lock.

Manual Career Evidence and Opportunities create/edit commands derive their provenance on the trusted server. Browser input cannot
claim scraper provenance. Revision/audit records identify manual mutations separately from AI
proposals and extension-scraped submissions. Missing provenance fails closed rather than being
silently presented as automated evidence.

Acceptance tests cover an authenticated user with no evidence, resume artifact, AI configuration,
or job-site session: all three workspaces remain reachable, while all three automated capabilities
remain locked. Anonymous users remain locked out, and officer-only routes keep their existing role
checks.
