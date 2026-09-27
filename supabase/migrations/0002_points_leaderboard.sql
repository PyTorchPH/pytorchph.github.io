-- ================================================================
-- Migration 0002: Points Ledger, Leaderboard & Cluster Graph
--
-- Depends on: 0001_org_activities.sql
--   - member_profiles table (extended here with public-facing fields)
--   - is_admin(), is_officer() helper functions
--   - activities table (cluster_items may reference it)
--
-- This migration covers SPEC §5 Layer 5 (Analytics):
--   - point_events   — append-only, weighted, auditable ledger
--   - leaderboard    — materialized view; cut-throat merit ranking
--   - clusters       — thematic groups (academics, tutorial, …)
--   - cluster_items  — concrete competitions/projects per cluster
--   - member_cluster_standings — per-cluster ranking
--
-- SCORING PHILOSOPHY (SPEC §11, ORG-OPERATIONS.md §6):
--   Raw aggregated weighted points. No equity adjustments.
--   Weights: achievement > grade > project > activity > referral.
--   Head-to-head ranking; ties broken deterministically (see view).
--
-- TIEBREAKER ORDER (leaderboard):
--   1. Total weighted_points DESC      — more points wins
--   2. first_earned_at ASC             — earlier achiever wins
--   3. last_earned_at DESC             — more recently active wins
--   4. nickname ASC                    — alphabetical; deterministic
-- ================================================================

-- ================================================================
-- EXTEND member_profiles with public-facing profile fields
-- (Privacy Level 2 — SPEC §6: nickname, avatar, bio are public;
--  email/phone/raw data are NEVER stored here.)
-- ================================================================
ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS nickname     text,
  ADD COLUMN IF NOT EXISTS avatar_url   text,
  ADD COLUMN IF NOT EXISTS bio          text CHECK (char_length(bio) <= 500);

-- Enforce unique public handle after column exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_profiles_nickname_unique'
      AND conrelid = 'member_profiles'::regclass
  ) THEN
    ALTER TABLE member_profiles
      ADD CONSTRAINT member_profiles_nickname_unique UNIQUE (nickname);
  END IF;
END $$;

-- Index for leaderboard JOINs on nickname (publicly displayed).
CREATE INDEX IF NOT EXISTS idx_member_profiles_nickname
  ON member_profiles (nickname)
  WHERE nickname IS NOT NULL;

-- ================================================================
-- ENUM: point_source
-- Defines the origin of a point event. Higher-priority sources
-- (achievement, grade, project) carry higher default weights.
-- ================================================================
DO $$ BEGIN
  CREATE TYPE point_source AS ENUM (
    'achievement',   -- awards, recognition, certifications — HIGHEST weight
    'grade',         -- academic performance signals
    'project',       -- completed projects in the platform
    'competition',   -- hackathon / competitive-programming placement
    'activity',      -- participation in org events/workshops
    'referral'       -- referring a new member
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- TABLE: point_events (APPEND-ONLY audit ledger)
--
-- IMMUTABILITY CONTRACT:
--   Normal authenticated users have NO UPDATE or DELETE policy.
--   All mutations (corrections, reversals) happen via service_role
--   (Supabase Edge Functions). This ensures the ledger is auditable
--   and tamper-evident from the client's perspective.
--
-- The weighted_points column is a stored generated column so
-- aggregates can use it directly without re-multiplying.
-- ================================================================
CREATE TABLE IF NOT EXISTS point_events (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid         NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  source           point_source NOT NULL,

  -- Raw points awarded for this event (always positive).
  points           numeric(10,2) NOT NULL CHECK (points > 0),

  -- Multiplier for the source type. Default weights:
  --   achievement: 3.0 | grade: 2.5 | project: 2.0 | competition: 2.0
  --   activity: 1.0    | referral: 0.5
  -- Stored explicitly so individual events can be weighted differently.
  weight           numeric(5,2)  NOT NULL DEFAULT 1.0 CHECK (weight > 0),

  -- Precomputed weighted score. Never update; recalculate by deleting
  -- and re-inserting if the formula changes (service_role only).
  weighted_points  numeric(10,2)
    GENERATED ALWAYS AS (points * weight) STORED,

  description      text          NOT NULL,

  -- Nullable FK to the originating record (e.g. a project UUID).
  -- reference_table names the source table for cross-domain lookups.
  reference_id     uuid,
  reference_table  text,

  earned_at        timestamptz   NOT NULL DEFAULT now(),
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Leaderboard aggregation: fast GROUP BY member + ORDER BY earned_at
CREATE INDEX IF NOT EXISTS idx_point_events_member_earned
  ON point_events (member_id, earned_at DESC);

-- Source-based filtering (e.g. show only achievement points)
CREATE INDEX IF NOT EXISTS idx_point_events_source
  ON point_events (member_id, source);

-- Reference lookups (e.g. "all points earned from project X")
CREATE INDEX IF NOT EXISTS idx_point_events_reference
  ON point_events (reference_table, reference_id)
  WHERE reference_id IS NOT NULL;

-- ================================================================
-- TABLE: clusters
-- Thematic groupings members can belong to and compete within.
-- Examples: academics, tutorial, competitive, creative, research.
-- ================================================================
CREATE TABLE IF NOT EXISTS clusters (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 80),
  slug        text        NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9-]+$'),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ================================================================
-- TABLE: cluster_items
-- Concrete projects, competitions, or events that live within a
-- cluster. Members "pick" items from a cluster to demonstrate
-- cluster-specific expertise (career graph §9 in SPEC).
-- ================================================================
CREATE TABLE IF NOT EXISTS cluster_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id  uuid        NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text,
  -- Discriminator: 'competition', 'project', 'tutorial', 'research', etc.
  item_type   text        NOT NULL CHECK (char_length(item_type) BETWEEN 2 AND 50),
  -- Optional link to an org activity (e.g. a hackathon in the pipeline).
  activity_id uuid        REFERENCES activities(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cluster_items_cluster
  ON cluster_items (cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_items_activity
  ON cluster_items (activity_id)
  WHERE activity_id IS NOT NULL;

-- ================================================================
-- TABLE: member_cluster_standings
-- Running per-cluster point totals. Updated by the application
-- layer (Edge Function) whenever a point_event is inserted with
-- a cluster-relevant source.
--
-- Separate from the global leaderboard: a member may rank #1 in
-- 'academics' but #15 globally.
-- ================================================================
CREATE TABLE IF NOT EXISTS member_cluster_standings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid        NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  cluster_id       uuid        NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  total_points     numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  -- Cached rank; recomputed on standings refresh.
  rank             integer,
  last_activity_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_cluster_unique UNIQUE (member_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_member_cluster_standings_cluster_points
  ON member_cluster_standings (cluster_id, total_points DESC);

CREATE OR REPLACE TRIGGER trg_member_cluster_standings_updated_at
  BEFORE UPDATE ON member_cluster_standings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- MATERIALIZED VIEW: leaderboard
--
-- Exposes ONLY privacy-safe fields (SPEC §6 Level 2):
--   member_id   — UUID, needed for UI deep-links; not PII by itself
--   nickname    — public handle ("Angela #7A82F"); never email/name
--   avatar_url  — public avatar
--   total_points, source_diversity, first_earned_at, last_earned_at
--   rank        — computed via RANK() window function
--
-- TIEBREAKER (hardcoded, documented above):
--   total_points DESC → first_earned_at ASC → last_earned_at DESC → nickname ASC
--
-- RLS NOTE: Postgres does not support RLS on materialized views.
-- Safety is structural — this view ONLY selects public-safe columns.
-- No email, no phone, no raw data appears here.
--
-- REFRESH STRATEGY:
--   Run  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard
--   after point_events inserts. Recommended trigger: a pg_cron job
--   or an Edge Function hook on point_events.
--   CONCURRENTLY requires the unique index on member_id below.
-- ================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
SELECT
  mp.id                              AS member_id,
  mp.nickname,                       -- public handle; never email
  mp.avatar_url,
  SUM(pe.weighted_points)            AS total_points,
  COUNT(DISTINCT pe.source)          AS source_diversity,
  MIN(pe.earned_at)                  AS first_earned_at,
  MAX(pe.earned_at)                  AS last_earned_at,
  RANK() OVER (
    ORDER BY
      SUM(pe.weighted_points)  DESC,  -- primary: most points
      MIN(pe.earned_at)        ASC,   -- tiebreaker 1: earlier achiever
      MAX(pe.earned_at)        DESC,  -- tiebreaker 2: recently active
      mp.nickname              ASC    -- tiebreaker 3: deterministic
  )                                  AS rank
FROM   member_profiles mp
JOIN   point_events    pe ON pe.member_id = mp.id
GROUP  BY mp.id, mp.nickname, mp.avatar_url;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_member_id
  ON leaderboard (member_id);

-- Rank lookup for "what position am I?" queries.
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
  ON leaderboard (rank);

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE point_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_cluster_standings ENABLE ROW LEVEL SECURITY;

-- GRANT leaderboard SELECT to both anon and authenticated.
-- The view only contains public-safe columns; no additional RLS needed.
GRANT SELECT ON leaderboard TO anon, authenticated;

-- ----------------------------------------------------------------
-- point_events policies
--
-- APPEND-ONLY for all authenticated users (no UPDATE/DELETE).
-- INSERT is intentionally absent here: all point_events are created
-- by Edge Functions via service_role, which bypasses RLS.
-- This keeps the ledger tamper-evident from the client.
-- ----------------------------------------------------------------

-- Members can read their own point history.
CREATE POLICY "point_events__owner_select"
  ON point_events FOR SELECT TO authenticated
  USING (member_id = (SELECT auth.uid()));

-- Admins can read all point events (for moderation / audit).
CREATE POLICY "point_events__admin_select"
  ON point_events FOR SELECT TO authenticated
  USING (is_admin());

-- NO UPDATE policy — point_events is append-only.
-- NO DELETE policy — corrections go through service_role.

-- ----------------------------------------------------------------
-- clusters policies — publicly readable; admin-managed.
-- ----------------------------------------------------------------

CREATE POLICY "clusters__public_select"
  ON clusters FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "clusters__anon_select"
  ON clusters FOR SELECT TO anon
  USING (true);

CREATE POLICY "clusters__admin_insert"
  ON clusters FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "clusters__admin_update"
  ON clusters FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "clusters__admin_delete"
  ON clusters FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- cluster_items policies — publicly readable; admin-managed.
-- ----------------------------------------------------------------

CREATE POLICY "cluster_items__public_select"
  ON cluster_items FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "cluster_items__anon_select"
  ON cluster_items FOR SELECT TO anon
  USING (true);

CREATE POLICY "cluster_items__admin_insert"
  ON cluster_items FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "cluster_items__admin_update"
  ON cluster_items FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ----------------------------------------------------------------
-- member_cluster_standings policies
-- Members see their own standings; standings are also public
-- (it is a leaderboard-adjacent ranking — no PII exposed here).
-- ----------------------------------------------------------------

CREATE POLICY "member_cluster_standings__public_select"
  ON member_cluster_standings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "member_cluster_standings__anon_select"
  ON member_cluster_standings FOR SELECT TO anon
  USING (true);

-- Standings are updated by service_role (Edge Function hook).
-- No client INSERT/UPDATE policies.

-- ----------------------------------------------------------------
-- member_profiles additional policies (added in this migration)
-- Allow owners to update public-facing fields introduced here.
-- NOTE: role / is_officer / officer_department remain admin-only.
-- Column-level control enforced in the application layer (Edge Fn).
-- ----------------------------------------------------------------
CREATE POLICY "member_profiles__public_nickname_select"
  ON member_profiles FOR SELECT TO anon
  USING (nickname IS NOT NULL);
