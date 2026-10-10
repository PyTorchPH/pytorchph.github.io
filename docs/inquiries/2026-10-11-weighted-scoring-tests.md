# Inquiry: scoring tests after the approved positive-award change

## Scope

The accepted scoring requirement replaces signed `point_ledger.delta` corrections with active positive `point_awards`, saved event weights, and `SUM(weighted_points)`. It also requires skill tags and a weight decision on newly created events.

## Failing tests and evidence

- `backend/api/src/tests/event_results.rs:10,107` constructs `NewEvent` without the now-required `skill_tags`, `weight_milli`, and `weight_reason`. `cargo test --no-run` fails with `E0063` at both sites.
- `backend/api/src/tests/event_results.rs:82` expects signed correction rows from `point_ledger`. The accepted behavior removes the prior positive award, records the audit event, and writes the replacement positive award.
- `backend/api/src/tests/event_deletion.rs`, `evidence.rs`, `migrations.rs`, and `seed.rs` insert or query `point_ledger`. Migration `0021_weighted_scoring.sql` converts its net active balance to `point_awards` and drops the old table.

## Expected behavior and proposed resolution

Update only these obsolete test inputs and expectations after user approval. Preserve their checks for authorization, result revision, exact final points, event deletion, evidence removal, and migration integrity. Add focused checks that no negative award exists, every award retains its saved weight, and anonymous comparison responses omit member identity. Do not weaken or skip the tests.
