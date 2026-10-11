# Scoring and refresh design

## Placement policy

The model proposes **fixed base points per place**. Round-robin match results and
published tie-break rules decide the placement; they do not multiply points.
`point_awards.weight_milli` remains the existing event difficulty multiplier,
applied once to the base place points. Pairwise skill comparisons estimate skill
standing independently and never mint event awards.

Each published `scoring_model_versions` row should have immutable Markdown
`details_md`, category/skill coefficients, validation metrics, and a validated
place-points schedule (`place -> nonnegative integer points`, descending or
equal). Reject updates and deletes after publication. Creating an event copies
the model version, proposed schedule, selected schedule, and organizer override
reason into an event snapshot in the same transaction. Published results read
only the snapshot; a later model cannot change previous awards. If no model
schedule exists, require the organizer to enter every place point. An override
requires a nonempty reason and a revision audit event. Fixtures must cover
ties, missing places, legacy events, publication corrections, and model changes
after event creation.

## Bounded comparison scheduler

1. Select only approved members with verified evidence for the same skill.
   Snapshot evidence summaries without names, email, links containing account
   identity, or provider identifiers. Require at least two eligible members.
2. Maintain per-member per-skill counters for scheduled, completed, and pending
   reviews. Under a short transaction, rank candidates by fewest completed plus
   pending comparisons, then choose randomly among the least-served window.
3. Canonicalize each pair by opaque ID and exclude existing unresolved pairs
   and recently completed pairs. Cap new pairs per skill and per run. A unique
   `(skill, member_a, member_b, evidence_revision)` key prevents retry
   duplication; a stable run key prevents repeated scheduler invocations.
4. Assign an approved officer validator for that skill with the fewest pending
   tasks, excluding either subject. Store a task assignment, due time, attempt
   count, and reason. The queue returns only anonymous evidence and randomized
   A/B order. Validation must recheck officer role and assignment on vote.
5. Commit pair, assignment, counters, and an audit event atomically. A lease
   lets failed runs retry. Expired tasks are reassigned with a bounded retry
   count and an audit event. Exhausted tasks require admin review.

The staged worker checks every five minutes using an hourly run key and a
ten-minute lease. Each run considers at most 40 least-served candidates,
creates at most ten pairs and two new pairs per member, assigns three officers
per pair, and gives each task 72 hours. Exhausted or unassignable tasks carry
`review_required` status and appear in the admin scoring view. This worker has
not been deployed or measured against live traffic.

Fixture tests must cover sparse skills, a newly eligible member, one available
validator who is a subject, duplicate run keys, concurrent claims, expired
leases, revoked officer role, and payload redaction. Do not use live members as
test data.

## Leaderboard measurement gate

Before changing the detailed board to a saved view, record request counts,
duration percentiles, DB query duration, point-write counts, refresh queue lag,
revision, and cache age by bounded structured events. Measure at least one
normal activity cycle and one results-publishing burst. Avoid member IDs and
names in metrics. Choose the refresh interval and maximum staleness from those
measurements, then define a monotonic revision and read-after-write behavior:
the author's next read must use a revision at least as new as the committed
write or explicitly return a pending-refresh state. Test worker failure and
restart recovery before serving a materialized detailed board.
The current detailed board remains live, exposes its content revision, and reads
committed point writes directly (`maxStaleSeconds: 0`). The new structured
read/refresh duration events provide measurement after the code is deployed;
no interval for a materialized detailed board is assumed in advance.
