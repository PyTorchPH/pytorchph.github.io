---
logic_id: career-evidence.integrity-review
code_paths:
  - domains/protocol/organization
  - domains/server/organization
  - apps/portal/app/events
tests:
  - apps/portal/tests/evidence-integrity-contracts.test.ts
  - apps/portal/tests/operations-contracts.test.ts
feedback_events:
  - evidence.review_completed
  - evidence.sanction_applied
  - evidence.appeal_opened
  - evidence.appeal_resolved
related_logic:
  - career-evidence.ingestion
  - leaderboards.verification-views
---
# Integrity Review and Appeals

Only officers review claims or change leaderboard eligibility. A client anomaly is a risk signal,
not proof of intent. Officers may approve, report a scraper defect, reject an unsupported claim,
confirm falsification, or confirm scraper tampering. The latter two impose the same leaderboard
suspension; confirmed tampering additionally receives an internal officer-only violation type.

The affected member sees a sanitized decision reason and may open one appeal at a time. Existing
submitted JSON and source links are attached by reference. Internal signals and notes never appear
in member payloads. Any officer may resolve an appeal. A sanction remains until an appeal restores
eligibility, and every decision is append-only and attributable.

Member integrity responses contain only sanction ID, claim ID, safe reason, timestamps, and the
member's latest appeal. Officer appeal responses may additionally contain the violation type and
member-safe label needed for adjudication; neither response includes raw browser state.
