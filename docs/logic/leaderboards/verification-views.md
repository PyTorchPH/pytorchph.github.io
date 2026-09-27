---
logic_id: leaderboards.verification-views
code_paths:
  - domains/protocol/leaderboards
  - domains/server/leaderboards
  - apps/portal/app/leaderboards
tests:
  - apps/portal/tests/member-command-center.test.ts
  - apps/portal/tests/member-command-center.e2e.mjs
feedback_events:
  - leaderboard.view_loaded
related_logic:
  - career-evidence.ingestion
  - career-evidence.integrity-review
---
# Leaderboard Verification Views

The member leaderboard offers `both`, `verified`, and `pending` projections and defaults to `both`.
Verified points come only from append-only point events. Pending points are provisional values
computed by the server rubric; rejected claims and sanctioned members never appear.

Completed-season snapshots contain verified history only. Their `pending` projection is empty, while
`both` and `verified` return the immutable archived values with pending points fixed at zero.

Rows sort by total points descending. Equal totals use a stable internal order for pagination, but
the UI does not display ordinal rank numbers or imply that tied members outrank one another.
