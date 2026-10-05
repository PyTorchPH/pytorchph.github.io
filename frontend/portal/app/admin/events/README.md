# Officer event workflow

Status: event administration exists. The target adds proposal gates, planning tickets, amendments,
and release readiness without removing existing competition behavior.

## UI boundary

- Event creation starts an `event_proposal`; it does not immediately publish a canonical event.
- Show the current direct-parent reviewer, immutable revision digest, unresolved requirements, and
  approval history.
- After presidential approval, show planning tickets grouped by assigned position and deliverable.
- Only the assigned Events-subtree actor may edit its proposal/task scope.
- Event category, provenance, and eligibility become locked after approval; corrections use an
  amendment view with a new revision and approval chain.
- Publication controls are visible only when the server reports `ready_for_release` and presidential
  global-send capability.

## Existing code

Keep `competitive-event.tsx`, result/entrant behavior, and existing event labels compatible. Extend
`mail-workflow.tsx` to link an approved event version and message kind; do not store message category
as an unrelated free-text UI field.

## Tests

Cover proposal state rendering, stale-revision conflicts, parent review, rejected/resubmitted
proposals, planning tickets, external-partner consent evidence, amendments, publication readiness,
competition compatibility, and unauthorized action hiding plus server rejection.
