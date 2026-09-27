-- ================================================================
-- Migration 0004: Skills — Hybrid Taxonomy, HITL Approval,
--                 Per-Skill Leaderboard
--
-- Depends on: 0001_org_activities.sql, 0002_points_leaderboard.sql
--   - member_profiles table (auth foundation + public fields)
--   - point_events table (append-only ledger)
--   - is_admin(), is_officer() SECURITY DEFINER helpers (do NOT redefine)
--
-- DOMAIN OVERVIEW (SPEC §5 Layer 3 + Layer 5):
--   skills             — canonical approved skill set (the CACHE)
--   skill_aliases      — many aliases → one canonical skill (dedupe)
--   member_skills      — member ↔ approved skill link + per-skill points
--   point_event_skills — additive join table tagging point_events with
--                        skills (no destructive ALTER on 0002's schema)
--   skills_refresh_log — audit log capturing emergent-discovery runs
--   skill_leaderboard  — per-skill ranking matview (public-safe only)
--
-- HYBRID TAXONOMY MODEL:
--   "Preset" skills are admin-seeded rows (status='approved',
--   source='preset'). They enter already approved.
--   "Emergent" skills are discovered by the AI pipeline
--   (source='emergent') and enter as status='candidate'.
--   A HITL step (admin or officer) must flip status → 'approved'
--   before an emergent skill is visible in the approved skill set.
--   The approved set IS the cache: callers read skills WHERE
--   status='approved' instead of recomputing the taxonomy.
--
-- SKILLS CACHE STRATEGY:
--   The skills table (status='approved' rows) serves as the cached
--   canonical skill set. The skills_refresh_log table captures
--   when the emergent-discovery pipeline last ran, so callers can
--   determine how fresh the candidate list is without querying raw
--   extraction tables.
--
-- PER-SKILL LEADERBOARD TIEBREAKER (mirrors 0002 overall leaderboard):
--   1. skill_points DESC    — highest weighted points within the skill
--   2. first_earned_at ASC  — earlier achiever wins on tie
--   3. last_earned_at DESC  — more recently active wins on tie
--   4. nickname ASC         — deterministic alphabetical fallback
-- ================================================================

-- ----------------------------------------------------------------
-- ENUM TYPES (idempotent DO blocks)
-- ----------------------------------------------------------------

DO $$ BEGIN
  -- Tracks the HITL approval lifecycle of a discovered skill.
  -- Preset skills are seeded directly as 'approved'.
  -- Emergent skills enter as 'candidate' and are approved/rejected
  -- by an admin or officer (HITL gate).
  CREATE TYPE skill_status AS ENUM (
    'candidate',  -- emergent; awaiting human review
    'approved',   -- in the canonical approved set (the cache)
    'rejected'    -- discarded; will not appear in the approved set
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Whether the skill was seeded by an admin (preset) or surfaced
  -- by the AI extraction / emergent-discovery pipeline.
  CREATE TYPE skill_source AS ENUM (
    'preset',    -- admin-seeded canonical skill; enters as 'approved'
    'emergent'   -- AI-discovered from member data; enters as 'candidate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- TABLE: skills
--
-- Canonical skill registry. Acts as the shared skill cache for the
-- platform. Every consumer of skills reads from this table
-- (WHERE status = 'approved') instead of deriving the list from raw
-- extraction outputs.
--
-- HITL invariant: only is_admin() or is_officer() may UPDATE the
-- status column to 'approved' or 'rejected'. RLS enforces that no
-- regular member can UPDATE skills rows at all. Application layer
-- (Edge Function) may add further column-level guards if needed.
--
-- slug format: lowercase, alphanumeric, hyphens only.
-- Matches the clusters.slug convention established in 0002.
-- ================================================================
CREATE TABLE IF NOT EXISTS skills (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- URL-safe unique identifier. Used as a stable external key.
  -- Example: 'pytorch', 'javascript', 'competitive-programming'
  slug         text         NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9-]+$'),

  display_name text         NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 120),

  -- Optional grouping for the UI taxonomy browser.
  -- Examples: 'machine-learning', 'web-frontend', 'databases', 'soft-skills'
  -- Nullable: ungrouped skills are still valid.
  category     text
    CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 80),

  description  text,

  -- HITL approval lifecycle. Preset skills start as 'approved'.
  -- Emergent skills enter as 'candidate' until a human reviews them.
  status       skill_status NOT NULL DEFAULT 'candidate',

  -- Whether this skill was seeded by an admin or surfaced by AI.
  source       skill_source NOT NULL DEFAULT 'emergent',

  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),

  -- A preset skill must enter as 'approved' (not candidate or rejected).
  -- Emergent skills start as 'candidate'.
  CONSTRAINT preset_skill_is_approved
    CHECK (source != 'preset' OR status = 'approved')
);

-- Fast lookup of the approved canonical set (the primary read path).
CREATE INDEX IF NOT EXISTS idx_skills_status
  ON skills (status)
  WHERE status = 'approved';

-- Category browsing and grouping queries.
CREATE INDEX IF NOT EXISTS idx_skills_category
  ON skills (category)
  WHERE category IS NOT NULL;

-- Slug lookup (also covered by UNIQUE constraint but named explicitly).
CREATE INDEX IF NOT EXISTS idx_skills_slug
  ON skills (slug);

CREATE OR REPLACE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: skill_aliases
--
-- Maps many alias strings to one canonical skill.
-- Purpose: deduplicate variant names submitted by members or
-- extracted by AI. Examples:
--   "JS" → javascript, "PyTorch" → pytorch, "Node" → node-js
--
-- Aliases are global (UNIQUE on alias text). A string can only
-- resolve to one canonical skill. Normalization is enforced here;
-- the alias matching logic in Edge Functions should lowercase-trim
-- before looking up.
-- ================================================================
CREATE TABLE IF NOT EXISTS skill_aliases (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id   uuid        NOT NULL REFERENCES skills(id) ON DELETE CASCADE,

  -- The alias text (case-insensitive intent; store lowercased).
  -- Globally unique: one alias string can only point to one skill.
  alias      text        NOT NULL
    CHECK (char_length(alias) BETWEEN 1 AND 120),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT skill_aliases_unique UNIQUE (alias)
);

-- Alias → skill lookup (the primary use case).
CREATE INDEX IF NOT EXISTS idx_skill_aliases_alias
  ON skill_aliases (alias);

-- All aliases for a given skill (admin UI, alias management).
CREATE INDEX IF NOT EXISTS idx_skill_aliases_skill
  ON skill_aliases (skill_id);

-- ================================================================
-- TABLE: member_skills
--
-- Links a member to an approved skill and caches their per-skill
-- point total.
--
-- IMPORTANT — source of truth for skill_points:
--   The authoritative signal for a member's skill strength is:
--     SELECT SUM(pe.weighted_points)
--     FROM point_event_skills pes
--     JOIN point_events pe ON pe.id = pes.point_event_id
--     WHERE pes.skill_id = <skill_id>
--       AND pe.member_id = <member_id>
--   The skill_points column here is a DENORMALIZED CACHE updated
--   by an Edge Function after point_event_skills inserts. Do not
--   treat it as a source of truth — recompute from point_event_skills
--   for authoritative values.
--
-- Only approved skills may be linked here (enforced by FK + the Edge
-- Function that manages inserts — the DB does not have a CHECK on
-- skill status because skills can be approved retroactively).
-- Application layer must filter skill_id to approved skills on INSERT.
-- ================================================================
CREATE TABLE IF NOT EXISTS member_skills (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid          NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  skill_id      uuid          NOT NULL REFERENCES skills(id) ON DELETE CASCADE,

  -- Cached sum of weighted_points from point_event_skills for this
  -- (member, skill) pair. Updated by service_role Edge Function on
  -- point_event_skills insert. Read the comment above before using.
  skill_points  numeric(10,2) NOT NULL DEFAULT 0 CHECK (skill_points >= 0),

  -- Timestamp of the last point_events insert that affected this row.
  -- Used by the Edge Function to detect stale caches.
  last_updated_at timestamptz NOT NULL DEFAULT now(),

  -- One row per (member, skill) pair.
  CONSTRAINT member_skills_unique UNIQUE (member_id, skill_id)
);

-- Per-skill leaderboard aggregation (member_id + skill_id fast lookup).
CREATE INDEX IF NOT EXISTS idx_member_skills_skill_points
  ON member_skills (skill_id, skill_points DESC);

-- Member's full skill list lookup.
CREATE INDEX IF NOT EXISTS idx_member_skills_member
  ON member_skills (member_id);

-- ================================================================
-- TABLE: point_event_skills
--
-- ADDITIVE JOIN TABLE — does NOT alter point_events (0002).
--
-- Tags a point_event with one or more skills. A single achievement
-- (e.g. winning a competition) can credit multiple skills.
--
-- Design rationale: extending point_events destructively (ALTER TABLE
-- ADD COLUMN skill_id) would force a single-skill assumption and break
-- the many-to-many relationship. This join table is additive and
-- preserves the 0002 schema contract.
--
-- Lifecycle:
--   1. service_role inserts a point_events row (0002 contract).
--   2. service_role also inserts point_event_skills rows linking that
--      event to the relevant approved skills.
--   3. An Edge Function then updates member_skills.skill_points
--      (cached aggregate) for affected (member, skill) pairs.
--   4. skill_leaderboard is refreshed (CONCURRENTLY) on a schedule.
-- ================================================================
CREATE TABLE IF NOT EXISTS point_event_skills (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  point_event_id uuid        NOT NULL REFERENCES point_events(id) ON DELETE CASCADE,
  skill_id       uuid        NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Each (event, skill) pair is unique.
  CONSTRAINT point_event_skills_unique UNIQUE (point_event_id, skill_id)
);

-- The primary query pattern: all events tagged with a given skill.
-- Used by skill aggregation queries and the leaderboard refresh.
CREATE INDEX IF NOT EXISTS idx_point_event_skills_skill
  ON point_event_skills (skill_id);

-- Reverse lookup: all skills tagged to a point event.
CREATE INDEX IF NOT EXISTS idx_point_event_skills_event
  ON point_event_skills (point_event_id);

-- ================================================================
-- TABLE: skills_refresh_log
--
-- Append-only audit log capturing when the emergent-skill discovery
-- pipeline ran. Callers that need to know how fresh the candidate
-- list is can check the most recent 'emergent_scan' row here instead
-- of recomputing from raw extraction tables.
--
-- Also logs manual admin seeding runs for traceability.
-- ================================================================
CREATE TABLE IF NOT EXISTS skills_refresh_log (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Type of discovery run.
  discovery_type     text        NOT NULL
    CHECK (discovery_type IN ('emergent_scan', 'manual_seed')),

  -- How many new candidate/approved skills were surfaced in this run.
  skills_discovered  integer     NOT NULL DEFAULT 0 CHECK (skills_discovered >= 0),

  -- How many skills were moved to 'approved' as a result (may be 0
  -- for scans that only surfaced candidates without approving them).
  skills_approved    integer     NOT NULL DEFAULT 0 CHECK (skills_approved >= 0),

  -- NULL = automated pipeline run (service_role); non-null = admin-initiated.
  run_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Optional notes from the pipeline or admin about this run.
  notes              text,

  run_at             timestamptz NOT NULL DEFAULT now()
);

-- Most-recent-run queries (monitoring / staleness checks).
CREATE INDEX IF NOT EXISTS idx_skills_refresh_log_run_at
  ON skills_refresh_log (run_at DESC);

-- ================================================================
-- MATERIALIZED VIEW: skill_leaderboard
--
-- Per-skill merit ranking. Partitioned by skill, so every approved
-- skill has its own rank sequence.
--
-- PUBLIC-SAFE FIELDS ONLY (SPEC §6 Level 2 — no PII):
--   skill_id, skill_slug, skill_display_name  — taxonomy identifiers
--   member_id    — UUID only (not PII by itself)
--   nickname     — public handle ("Angela #7A82F"); never email/name
--   avatar_url   — public avatar
--   skill_points — aggregated weighted score for this skill
--   source_diversity — count of distinct point sources
--   first_earned_at, last_earned_at — for tiebreakers
--   rank         — RANK() partitioned per skill; gaps on ties (1,1,3)
--
-- TIEBREAKER (mirrors 0002 overall leaderboard — documented above):
--   skill_points DESC → first_earned_at ASC → last_earned_at DESC → nickname ASC
--
-- RLS NOTE: Postgres does not support RLS on materialized views.
-- Safety is structural: only public-safe columns are selected.
-- No email, phone, or raw data appears in the view schema.
--
-- REFRESH STRATEGY:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY skill_leaderboard
--   Run after point_event_skills inserts via an Edge Function hook
--   or a pg_cron job. CONCURRENTLY requires the unique index below.
-- ================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS skill_leaderboard AS
SELECT
  s.id                              AS skill_id,
  s.slug                            AS skill_slug,
  s.display_name                    AS skill_display_name,
  mp.id                             AS member_id,
  mp.nickname,                      -- public handle; never email
  mp.avatar_url,
  SUM(pe.weighted_points)           AS skill_points,
  COUNT(DISTINCT pe.source)         AS source_diversity,
  MIN(pe.earned_at)                 AS first_earned_at,
  MAX(pe.earned_at)                 AS last_earned_at,
  RANK() OVER (
    PARTITION BY s.id
    ORDER BY
      SUM(pe.weighted_points)  DESC,  -- primary: most skill-tagged points
      MIN(pe.earned_at)        ASC,   -- tiebreaker 1: earlier achiever
      MAX(pe.earned_at)        DESC,  -- tiebreaker 2: more recently active
      mp.nickname              ASC    -- tiebreaker 3: deterministic
  )                                   AS rank
FROM skills s
JOIN point_event_skills pes  ON pes.skill_id = s.id
JOIN point_events pe         ON pe.id = pes.point_event_id
JOIN member_profiles mp      ON mp.id = pe.member_id
WHERE s.status = 'approved'
GROUP BY s.id, s.slug, s.display_name, mp.id, mp.nickname, mp.avatar_url;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_leaderboard_skill_member
  ON skill_leaderboard (skill_id, member_id);

-- "Top N in skill X" query (rank filter per skill).
CREATE INDEX IF NOT EXISTS idx_skill_leaderboard_skill_rank
  ON skill_leaderboard (skill_id, rank);

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_aliases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_skills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_event_skills  ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills_refresh_log  ENABLE ROW LEVEL SECURITY;

-- skill_leaderboard is a matview — no RLS supported in Postgres.
-- Safety is structural (public-safe columns only, as documented above).
GRANT SELECT ON skill_leaderboard TO anon, authenticated;

-- ----------------------------------------------------------------
-- skills policies
--
-- READ: Everyone (anon + authenticated) can read approved skills.
-- This powers the public taxonomy browser and skill tag UI.
-- Candidates and rejected skills are restricted to officers/admins
-- (they represent pending HITL decisions, not public data).
--
-- WRITE: Only admins or officers may UPDATE status (HITL approval).
-- Regular members cannot INSERT, UPDATE, or DELETE skill rows.
-- Admin manages the canonical list; officers approve emergent skills.
-- ----------------------------------------------------------------

-- Anon/authenticated may SELECT only approved skills (the public cache).
CREATE POLICY "skills__public_approved_select"
  ON skills FOR SELECT TO anon
  USING (status = 'approved');

CREATE POLICY "skills__auth_approved_select"
  ON skills FOR SELECT TO authenticated
  USING (status = 'approved');

-- Officers and admins may see all skills including candidates/rejected
-- (needed for the HITL approval dashboard).
CREATE POLICY "skills__officer_all_select"
  ON skills FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- Only admins may insert new skill rows (preset seeding).
-- Emergent skills are inserted by service_role (Edge Function pipeline).
CREATE POLICY "skills__admin_insert"
  ON skills FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Admins and officers may UPDATE skills (primarily for status transitions).
-- Column-level enforcement of valid transitions (e.g. candidate→approved,
-- not approved→candidate) is the responsibility of the Edge Function.
CREATE POLICY "skills__officer_update"
  ON skills FOR UPDATE TO authenticated
  USING  (is_admin() OR is_officer())
  WITH CHECK (is_admin() OR is_officer());

-- Only admins may hard-delete skill rows.
-- Soft-deprecation is preferred: set status = 'rejected' instead.
CREATE POLICY "skills__admin_delete"
  ON skills FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- skill_aliases policies
--
-- READ: Authenticated users can read all aliases (needed for the
-- alias-matching autocomplete on the member skills input).
-- Anon read is also allowed — alias resolution is not sensitive.
--
-- WRITE: Admin only. Alias management is an admin task.
-- ----------------------------------------------------------------

CREATE POLICY "skill_aliases__anon_select"
  ON skill_aliases FOR SELECT TO anon
  USING (true);

CREATE POLICY "skill_aliases__auth_select"
  ON skill_aliases FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "skill_aliases__admin_insert"
  ON skill_aliases FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "skill_aliases__admin_update"
  ON skill_aliases FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "skill_aliases__admin_delete"
  ON skill_aliases FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- member_skills policies
--
-- READ: Members see only their own skill links. Officers and admins
-- see all member skills (needed for competition matching and HITL).
-- Anon users see nothing — member skill portfolios are private by
-- default; public exposure is via the skill_leaderboard matview only.
--
-- WRITE: service_role manages inserts/updates (cache maintenance).
-- No client INSERT/UPDATE policy — client cannot self-assign skills.
-- Skills are derived from verified point_event_skills only.
-- ----------------------------------------------------------------

CREATE POLICY "member_skills__owner_select"
  ON member_skills FOR SELECT TO authenticated
  USING (member_id = (SELECT auth.uid()));

CREATE POLICY "member_skills__officer_or_admin_select"
  ON member_skills FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- No client INSERT/UPDATE/DELETE policies.
-- All writes go through service_role (Edge Functions).

-- ----------------------------------------------------------------
-- point_event_skills policies
--
-- READ: Members see tag links for their own point events.
-- Officers and admins see all.
--
-- WRITE: Append-only via service_role (same immutability contract as
-- point_events in 0002). No client INSERT/UPDATE/DELETE.
-- ----------------------------------------------------------------

CREATE POLICY "point_event_skills__owner_select"
  ON point_event_skills FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM point_events pe
      WHERE pe.id = point_event_skills.point_event_id
        AND pe.member_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "point_event_skills__admin_select"
  ON point_event_skills FOR SELECT TO authenticated
  USING (is_admin());

-- No UPDATE/DELETE policies — point_event_skills is append-only.
-- Corrections via service_role only (mirrors point_events contract).

-- ----------------------------------------------------------------
-- skills_refresh_log policies
--
-- READ: Officers and admins may view the discovery log (operational
-- dashboard for HITL reviewers to see how stale the candidate list is).
-- Regular members and anon have no access.
--
-- WRITE: service_role (automated pipeline) and admin (manual runs).
-- ----------------------------------------------------------------

CREATE POLICY "skills_refresh_log__officer_or_admin_select"
  ON skills_refresh_log FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- Admin may manually log a seeding run.
CREATE POLICY "skills_refresh_log__admin_insert"
  ON skills_refresh_log FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Refresh log rows are immutable (no UPDATE/DELETE for clients).
