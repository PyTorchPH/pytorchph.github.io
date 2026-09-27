---
logic_id: career-evidence.ingestion
code_paths:
  - domains/protocol/career-evidence
  - domains/server/career-evidence
  - supabase/migrations
tests:
  - apps/portal/tests/evidence-integrity-contracts.test.ts
  - apps/portal/tests/supabase-migrations.test.ts
feedback_events:
  - evidence.submission_accepted
  - evidence.submission_rejected
  - evidence.rubric_applied
related_logic:
  - client-automation.evidence-extension
  - career-evidence.integrity-review
  - leaderboards.verification-views
---
# Career Evidence Ingestion

Every extension or manual payload is an untrusted proposal. Validate a strict versioned envelope,
canonicalize its source URL, enforce size limits, and deduplicate by member plus content hash.
Persist normalized evidence, not raw DOM or session material.

Manual entry remains available without an AI endpoint or scraper session. The trusted server derives
manual create/update provenance and records it in revision history; the client cannot relabel a
manual mutation as scraped. Extension envelopes retain `extension_scrape` origin, so audit views and
logs can distinguish user-authored facts from automated collection.

New claims start `pending`. The extension may propose an evidence level, but only the server applies
the published rubric. Official point events are appended atomically only after an officer approves
the exact immutable claim revision. Client state, extension build metadata, and requested points can
never create verified points.
