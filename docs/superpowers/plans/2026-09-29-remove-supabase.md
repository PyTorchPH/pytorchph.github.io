# Remove Supabase; Rust API + SQLite as the only backend

Status: **plan, awaiting approval** (High-risk: auth, schema migrations, destructive deletes).
Date: 2026-09-29. Scope: `website/` repo only.

## Decisions (confirmed by the user)

| # | Decision |
|---|---|
| D1 | Delete the Next.js server mode (`apps/portal/app/api/**`, `app/auth/callback`, `proxy.ts`, `vercel.json`). Every portal page calls the Rust API (`/auth/*`, `/portal/api/*`, `/evidence*`, `/leaderboard`), as the live static build already does. |
| D2 | Build real Rust tables for: evidence appeals, leaderboard seasons, sanctions, rank policy/thresholds, point rubric, skills, competitions. |
| D3 | Do **not** build: payments / membership payment reviews, referrals. Remove their UI and code paths. |
| D4 | Schema is highly normalized: one fact in one place; a table per user-owned field set when it avoids duplication. |
| D5 | Every child row cascades: deleting a member (or parent entity) deletes everything that depends on it (`ON DELETE CASCADE`). |
| D6 | Tables for removed features are dropped by migration; no table is kept without a live reader/writer. |
| D7 | Ship synthetic sample data so new users see a populated portal. The user deletes it later; it MUST be removable in one step (see "Sample data"). |

## Current state (verified)

- Live: static Next export (`apps/pages-demo`, re-exports `apps/portal` pages) → `https://api.pytorch.ph` (Rust/Axum, SQLite WAL).
- Rust schema: 28 tables in `apps/api/migrations/0001–0004`. `foreign_keys(true)` is on.
- **Gap: `0001_core.sql` has 35 `REFERENCES` and 0 `ON DELETE CASCADE`.** Deleting a member with points, entrants, claims, roles, or mail rows fails today. Violates D5.
- Supabase: 81 tracked files; `supabase/` (config, 13 migrations, ~65 tables, seed); `@supabase/*` deps in 4 `package.json`.
- Portal views not backed by real tables are faked as JSON blobs in `portal_state` via `/portal/api/{*path}`.

## Phase 1 — Schema: cascade + normalization (Rust, migration `0005`)

SQLite cannot `ALTER` a foreign key, so each affected table is rebuilt:
`CREATE TABLE x_new (... REFERENCES p(id) ON DELETE CASCADE) → INSERT INTO x_new SELECT … → DROP TABLE x → ALTER TABLE x_new RENAME TO x → recreate indexes`,
inside one transaction with `PRAGMA foreign_keys=OFF` then `PRAGMA foreign_key_check` (MUST return 0 rows) before commit.

Rules applied to every table (existing and new):
- Surrogate `id TEXT PRIMARY KEY` (UUID) or natural composite PK for pure join tables.
- Every FK: `NOT NULL … ON DELETE CASCADE`, except audit/ledger rows that must outlive an actor → `ON DELETE SET NULL` on the actor column only (listed explicitly in the migration; none by default).
- No repeated denormalized columns (names, emails, role labels) in child tables; read them by join.
- Enumerations as `CHECK (col IN (...))`, not free text.
- Index every FK column.

Tables rebuilt with cascade (from `0001_core`/`0002`/`0004`): `sessions`, `entrants`, `entrant_members`, `results`, `point_ledger`, `evidence_claims`, `attendance_sources`, `attendance_responses`, `officer_roles`, `mail_*`, `email_credentials`, `portal_state`, `portal_media` (exact list generated from `REFERENCES` in the migration review).

## Phase 2 — New Rust tables (D2), migration `0006`

| Domain | Tables (normalized) | Parent (cascade) |
|---|---|---|
| Appeals | `evidence_appeals(id, claim_id, reason, status, created_at)`, `evidence_appeal_decisions(appeal_id PK, officer_id, decision, note, decided_at)` | `evidence_claims`, `members` |
| Claim reviews | `evidence_claim_reviews(id, claim_id, officer_id, decision, note, reviewed_at)` | `evidence_claims`, `members` |
| Seasons | `leaderboard_seasons(id, name, starts_on, ends_on, status)`, `leaderboard_snapshots(season_id, member_id, rank, points, PK(season_id, member_id))` | `leaderboard_seasons`, `members` |
| Rank policy | `rank_policies(id, season_id, name)`, `rank_thresholds(policy_id, tier, min_points, PK(policy_id, tier))` | `leaderboard_seasons`, `rank_policies` |
| Sanctions | `member_sanctions(id, member_id, season_id, kind, points_delta, reason, issued_by, issued_at, lifted_at)` | `members`, `leaderboard_seasons` |
| Point rubric | `point_rubrics(id, name, active)`, `point_rubric_items(id, rubric_id, activity_kind, points)` | `point_rubrics` |
| Skills | `skills(id, name UNIQUE)`, `member_skills(member_id, skill_id, verified_by, PK(member_id, skill_id))` | `members`, `skills` |
| Competitions | `competitions(id, event_id, title, starts_at)`, `competition_judges(competition_id, member_id, PK)`, `competition_winners(competition_id, member_id, place, PK(competition_id, place))` | `events`, `members` |

Officer review stays mandatory: a claim contributes points only through `evidence_claim_reviews.decision = 'approved'` → `point_ledger` (existing `officer_result_is_authoritative…` rule).

Endpoints (Axum, same auth + `check_origin` as today): `GET/POST /evidence/{id}/appeals`, `POST /appeals/{id}/decision` (officer), `GET /leaderboard?season=`, `GET/POST /seasons` (officer), `POST /members/{id}/sanctions` (officer), `GET /skills`, `PUT /members/me/skills`, `GET/POST /competitions` (officer write). `/portal/api/*` handlers that currently fake these switch to the tables; the JSON-blob fallback is removed for them.

## Phase 3 — Remove Supabase (TypeScript)

| Action | Files |
|---|---|
| Delete | `supabase/**`; `domains/server/identity/session/{create-admin-client,create-user-client}.ts`; `domains/client/identity/session/create-browser-client.ts`; `domains/server/career-evidence/read-supabase.ts`; `apps/portal/scripts/seed-demo-storage.mjs`; `development/local-access/watch-login.mjs`; `apps/portal/tests/supabase-migrations.test.ts`; `apps/portal/app/api/**`, `app/auth/callback`, `proxy.ts`, `vercel.json` (D1) |
| Replace with Rust API calls | `read-viewer`, `select-provider` → `/auth/me`; `collect-credentials.tsx` drops the Supabase OAuth branch; `select-repository`, `run-command`, `submit-evidence`, `read-standing`, `run-operation`, `manage-report` → Rust endpoints (or deleted if only used by D1 routes); `apps/pages-demo/app/demo-identity.ts` stub removed |
| Remove (D3) | payment review + referral UI, routes, fixtures |
| Deps / env | drop `@supabase/ssr`, `@supabase/supabase-js`, `test:supabase`; `.env.example` + `apps/portal/.env.example`: remove `SUPABASE_*`, `PYTORCH_PH_DATA_PROVIDER`, add `NEXT_PUBLIC_API_ORIGIN` |
| Tests to update | `product-gateway`, `nationwide-membership`, `evidence-integrity-contracts`, `trust-center`, `tests/node/workspace-boundaries`, `tests/node/logic-doc-contracts` |
| Docs | reword `docs/**`, READMEs, `trust/page.tsx`; keep `legacy/python/**` and dated `docs/superpowers/**` as history |

## Sample data (D7)

- Seed via a separate migration-free seeder (`SEED_SAMPLE_DATA=true`), never inside schema migrations.
- Every sample row hangs off sample members with emails under `@sample.pytorch.ph` and `members.is_sample = 1`.
- Removal is one statement: `DELETE FROM members WHERE is_sample = 1;` — cascades (D5) remove all dependent rows. Org-level sample rows (seasons, competitions, skills) carry `is_sample = 1` and are removed by `DELETE … WHERE is_sample = 1` per root table (documented in `apps/api/deploy/README.md`).
- UI labels sample content as sample (existing "synthetic" badges).

## Verification

- `cargo test` (docker `rust:1.98`): new tests for cascade (delete member → 0 dependent rows in every table, generated from `sqlite_master`), appeal flow, season snapshot, sanctions, skills, competitions, sample purge.
- `PRAGMA foreign_key_check` empty after `0005`/`0006` on a copy of production `portal.db`.
- `npm test`, portal `tsc`, `build:pages`, `test:pages`; `git grep -i supabase` → only legacy/historical hits.
- Pre-existing failures to fix or triage first: `test:boundaries` (`collect-credentials.tsx` boundary), `test:nationwide`, `test:pages` (Career Evidence link timeout).

## Rollout and rollback

1. PRs per phase (1 → 2 → 3); no API deploy without separate explicit approval.
2. Deploy: SQLite online backup + old binary backup → new binary → service restart applies migrations → health + member/officer smoke.
3. Rollback: restore backup DB + old binary, restart. Pages: `git revert` the phase commit.

## Open questions

1. Audit/ledger rows (`point_ledger`, `audit_events`, `mail_approvals`): cascade-delete with the member (D5 literal) or keep with actor set to NULL for accountability? Default in this plan: **cascade**, per D5.
2. "Table deleted when its use disappears" is implemented as: feature removal ⇒ a migration drops its tables (D6). Tables are never dropped automatically at runtime.
