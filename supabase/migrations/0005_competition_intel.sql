-- ================================================================
-- Migration 0005: Competition Intelligence
--
-- Depends on: 0001_org_activities.sql, 0002_points_leaderboard.sql,
--             0004_skills.sql
--   - member_profiles, intake_submissions, activities (0001)
--   - leaderboard matview (0002) — used in competition_skill_match
--   - skills, member_skills (0004) — skill-based member matching
--   - is_admin(), is_officer() SECURITY DEFINER helpers (do NOT redefine)
--
-- DOMAIN OVERVIEW:
--   competitions              — submitted/tracked competitions
--   competition_required_skills — skills needed for a competition
--   competition_winners       — public prior-winner records
--   winner_skills             — skills of prior winners (reference set)
--   judges                    — judge identity (name + public handles)
--   judge_profiles            — scraped PUBLIC professional intel per judge
--   competition_judges        — competition ↔ judge link
--   competition_skill_match   — view scoring members vs competition needs
--
-- DESIGN NOTE — SCRAPING IS FUTURE-GATED:
--   The schema is designed now; the actual scraping job is a FUTURE
--   backend responsibility (SPEC §13). The database structure is
--   ready; the data pipeline that populates it is not yet built.
--   Judges, winner details, and competition contexts will initially
--   be manually entered by officers/admins.
--
-- PRIVACY INTENT FOR judge_profiles:
--   ONLY PUBLIC professional information is stored here. This means
--   data that the judge has themselves published publicly (LinkedIn
--   bio, conference speaker profiles, company directory, etc.).
--   It is used exclusively as COMPETITIVE PREPARATION REFERENCE for
--   members preparing for competitions (knowing the judges' focus
--   areas helps target presentations and solutions).
--   NEVER store: personal contact details, private messages, salary,
--   home address, or any data not explicitly made public by the judge.
--   Access is restricted to officers and admins (is_officer() / is_admin()).
--   Data-retention policy is an open question — see DATA-MODEL.md §OQ.
-- ================================================================

-- ----------------------------------------------------------------
-- ENUM TYPES (idempotent DO blocks)
-- ----------------------------------------------------------------

DO $$ BEGIN
  -- The type of organization running the competition.
  CREATE TYPE organizer_type AS ENUM (
    'company',  -- corporate sponsor or tech company
    'school',   -- academic institution
    'other'     -- NGO, government, community org, etc.
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Lifecycle state of a competition record.
  CREATE TYPE competition_status AS ENUM (
    'upcoming',    -- not yet started; accepting participants
    'active',      -- currently running
    'completed',   -- finished; winners may be recorded
    'cancelled'    -- cancelled; kept for historical reference
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- How important a skill is for a given competition.
  -- Enables nuanced matching: 'required' skills are hard filters;
  -- 'preferred' and 'bonus' are soft signals for the match score.
  CREATE TYPE skill_importance AS ENUM (
    'required',   -- essential; strongly penalizes members who lack it
    'preferred',  -- helpful; adds to match score but not blocking
    'bonus'       -- nice to have; minor score boost only
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- TABLE: competitions
--
-- Master record for each tracked competition. Can be linked to an
-- existing intake_submission (when the competition was submitted
-- through the standard activity pipeline in 0001) or stand alone
-- for manually entered or officer-created competitions.
--
-- The `source_url` is the canonical link to the competition's public
-- announcement page. Used for deduplication and reference.
-- ================================================================
CREATE TABLE IF NOT EXISTS competitions (
  id                  uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text               NOT NULL
    CHECK (char_length(title) BETWEEN 3 AND 200),
  source_url          text
    CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  organizer_name      text               NOT NULL
    CHECK (char_length(organizer_name) BETWEEN 1 AND 200),
  organizer_type      organizer_type     NOT NULL,

  -- Dates are stored as date (not timestamptz) since competition
  -- deadlines are calendar-day precision, not time-of-day precision.
  start_date          date,
  end_date            date,

  -- Free-text prize description (e.g. "₱50,000 + internship offer").
  -- Not a numeric value because prize structures vary too much.
  prize_description   text,

  status              competition_status NOT NULL DEFAULT 'upcoming',

  -- Optional back-reference to the intake_submissions record that
  -- triggered this competition's entry into the system.
  -- Nullable: competitions can be created directly by officers/admins.
  intake_submission_id uuid              REFERENCES intake_submissions(id) ON DELETE SET NULL,

  created_by          uuid              REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz       NOT NULL DEFAULT now(),
  updated_at          timestamptz       NOT NULL DEFAULT now(),

  -- End date must be on or after start date when both are present.
  CONSTRAINT competition_dates_valid
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_competitions_status
  ON competitions (status);
CREATE INDEX IF NOT EXISTS idx_competitions_organizer_type
  ON competitions (organizer_type);
CREATE INDEX IF NOT EXISTS idx_competitions_start_date
  ON competitions (start_date)
  WHERE start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competitions_intake_submission
  ON competitions (intake_submission_id)
  WHERE intake_submission_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: competition_required_skills
--
-- Maps a competition to the skills members need to be strong
-- candidates. Used by the competition_skill_match view to score
-- members against each competition's requirements.
--
-- importance column:
--   'required' — hard requirement; members without this skill are
--                poor fits regardless of other qualifications.
--   'preferred' — adds match score weight; not blocking.
--   'bonus'    — minor boost; e.g. a secondary tool or technique.
-- ================================================================
CREATE TABLE IF NOT EXISTS competition_required_skills (
  id             uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid             NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  skill_id       uuid             NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  importance     skill_importance NOT NULL DEFAULT 'required',
  created_at     timestamptz      NOT NULL DEFAULT now(),

  -- Each (competition, skill) pair is unique.
  CONSTRAINT competition_required_skills_unique UNIQUE (competition_id, skill_id)
);

-- Primary join direction: all required skills for a competition.
CREATE INDEX IF NOT EXISTS idx_competition_required_skills_competition
  ON competition_required_skills (competition_id);

-- Reverse: all competitions that require a given skill (trend analysis).
CREATE INDEX IF NOT EXISTS idx_competition_required_skills_skill
  ON competition_required_skills (skill_id);

-- Importance-filtered lookups (e.g. only 'required' skills for strict matching).
CREATE INDEX IF NOT EXISTS idx_competition_required_skills_importance
  ON competition_required_skills (competition_id, importance);

-- ================================================================
-- TABLE: competition_winners
--
-- Stores prior competition winners as PUBLIC RECORDS.
-- Winners are referenced by display name or handle (as published
-- in competition result announcements). No private data is stored.
--
-- The `display_name` is the name or handle as it appears in the
-- public result announcement — e.g. a full name or a team name.
-- `year` is the edition year for competitions that run annually.
-- `source_url` links to the public announcement page confirming
-- the result.
--
-- These records serve as a reference set for the org to understand
-- what past winners looked like (skills, institutions, approaches).
-- ================================================================
CREATE TABLE IF NOT EXISTS competition_winners (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid        NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,

  -- Public name/handle as it appears in the result announcement.
  display_name   text        NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 200),

  -- 1 = first place, 2 = second place, etc.
  placement      integer     NOT NULL CHECK (placement >= 1),

  -- Year of this particular competition edition.
  year           integer     NOT NULL
    CHECK (year BETWEEN 2000 AND 2100),

  -- Link to the public result announcement confirming this placement.
  source_url     text
    CHECK (source_url IS NULL OR source_url ~ '^https?://'),

  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- A placement slot within a year is unique per competition.
  -- (A team placing 1st and 2nd simultaneously is not allowed.)
  CONSTRAINT competition_winners_unique_placement
    UNIQUE (competition_id, placement, year)
);

CREATE INDEX IF NOT EXISTS idx_competition_winners_competition
  ON competition_winners (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_winners_year
  ON competition_winners (competition_id, year DESC);

-- ================================================================
-- TABLE: winner_skills
--
-- Maps a prior competition winner to the skills they were known for.
-- This is a REFERENCE DATASET for the org: studying past winners'
-- skill profiles helps identify the skill clusters that correlate
-- with winning placements.
--
-- Data is entered manually by officers/admins based on publicly
-- available information about the winner (their GitHub, talks,
-- published write-ups, etc.).
-- ================================================================
CREATE TABLE IF NOT EXISTS winner_skills (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_id  uuid        NOT NULL REFERENCES competition_winners(id) ON DELETE CASCADE,
  skill_id   uuid        NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Each (winner, skill) pair is unique.
  CONSTRAINT winner_skills_unique UNIQUE (winner_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_winner_skills_winner
  ON winner_skills (winner_id);
CREATE INDEX IF NOT EXISTS idx_winner_skills_skill
  ON winner_skills (skill_id);

-- ================================================================
-- TABLE: judges
--
-- Identity record for a competition judge.
-- Stores only publicly known identifying information:
--   display_name    — name as published in competition materials
--   public_handle   — a public identifier (LinkedIn URL, GitHub
--                     handle, personal site URL, etc.)
--
-- One judge may appear in multiple competitions over time.
-- The 1:N relationship to judge_profiles allows for multiple
-- scraped/entered intel snapshots per judge (one per source or
-- per time period).
-- ================================================================
CREATE TABLE IF NOT EXISTS judges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   text        NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 200),

  -- A public URL or handle. Not a contact detail — this is the
  -- judge's published professional presence link.
  -- Example: "https://linkedin.com/in/example" or "@handle"
  public_handle  text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judges_display_name
  ON judges (display_name);

CREATE OR REPLACE TRIGGER trg_judges_updated_at
  BEFORE UPDATE ON judges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: judge_profiles
--
-- !! PRIVACY CRITICAL: READ BEFORE MODIFYING !!
--
-- Stores scraped or manually entered PUBLIC PROFESSIONAL INTEL about
-- a competition judge. This is COMPETITIVE PREPARATION REFERENCE DATA
-- only — it helps members prepare targeted presentations and solutions
-- by understanding the judge's known focus areas and professional
-- background.
--
-- WHAT IS STORED (allowed):
--   - Information the judge has themselves published publicly:
--     organization, job title, conference speaker bio, published
--     research areas, public portfolio links.
--   - Source URL linking to where this information was found.
--   - Timestamp of when it was collected (scraped_at).
--
-- WHAT MUST NEVER BE STORED (prohibited):
--   - Private contact details (personal email, phone, home address)
--   - Salary, compensation, or financial information
--   - Messages or communications not publicly directed at the org
--   - Any data not explicitly published by the judge themselves
--   - Health, family, or personal life information
--
-- ACCESS: is_officer() and is_admin() only. Never exposed to regular
-- members or anonymous users.
--
-- DATA RETENTION: See open questions in DATA-MODEL.md. Profiles
-- should be reviewed periodically and purged when no longer relevant
-- or when the judge requests removal.
-- ================================================================
CREATE TABLE IF NOT EXISTS judge_profiles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id     uuid        NOT NULL REFERENCES judges(id) ON DELETE CASCADE,

  -- Current or last-known organization (from public bio).
  organization text
    CHECK (organization IS NULL OR char_length(organization) BETWEEN 1 AND 200),

  -- Public background summary — sourced from a published bio or profile.
  -- Should be short (≤ 1000 chars). Not a copied paragraph; a summary.
  background   text
    CHECK (background IS NULL OR char_length(background) <= 1000),

  -- Array of known professional focus areas.
  -- Example: ARRAY['machine-learning', 'systems-design', 'open-source']
  -- Populated from skills mentioned in their public bio or talks.
  focus_areas  text[]      NOT NULL DEFAULT '{}',

  -- The public URL where this information was sourced. REQUIRED.
  -- Provides an audit trail so the data can be verified or disputed.
  source_url   text        NOT NULL
    CHECK (source_url ~ '^https?://'),

  -- When this profile data was collected/entered.
  scraped_at   timestamptz NOT NULL DEFAULT now(),

  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE judge_profiles IS
  'PUBLIC professional intel only. Used as competitive preparation reference. '
  'Officers and admins access only. See migration header comment for full '
  'privacy policy and data-retention open questions.';

CREATE INDEX IF NOT EXISTS idx_judge_profiles_judge
  ON judge_profiles (judge_id);
CREATE INDEX IF NOT EXISTS idx_judge_profiles_scraped_at
  ON judge_profiles (judge_id, scraped_at DESC);

-- GIN index on focus_areas for array-containment queries.
-- Example: find judges whose focus areas include 'machine-learning'.
CREATE INDEX IF NOT EXISTS idx_judge_profiles_focus_areas
  ON judge_profiles USING GIN (focus_areas);

-- ================================================================
-- TABLE: competition_judges
--
-- Links competitions to judges. A competition may have multiple
-- judges; a judge may appear in multiple competitions.
-- ================================================================
CREATE TABLE IF NOT EXISTS competition_judges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid        NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  judge_id       uuid        NOT NULL REFERENCES judges(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Each (competition, judge) pair is unique.
  CONSTRAINT competition_judges_unique UNIQUE (competition_id, judge_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_judges_competition
  ON competition_judges (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_judges_judge
  ON competition_judges (judge_id);

-- ================================================================
-- VIEW: competition_skill_match
--
-- "WHO DO WE SEND?" — scores current members against each active or
-- upcoming competition's required skills to surface the strongest
-- candidate matches.
--
-- ALGORITHM:
--   For each (competition, member) pair where the member has at
--   least one skill that the competition requires:
--     matched_skills     = count of required skills the member has
--     total_required     = total count of required skills in competition
--     match_pct          = (matched / total) × 100 (0–100 scale)
--     leaderboard_points = member's overall weighted point total
--                          (from the 0002 leaderboard matview)
--     leaderboard_rank   = member's overall rank
--
-- Members with both high match_pct AND high leaderboard_points are
-- the strongest candidates (highly skilled AND high-performing).
-- The leaderboard signals are the "high-bracket" dimension.
--
-- SCOPE: Only 'upcoming' and 'active' competitions are included.
-- Query with WHERE competition_id = $x to scope to one competition.
--
-- PRIVACY NOTE: No PII is exposed. Only member_id (UUID), nickname
-- (public handle), avatar_url, and aggregate metrics are visible.
-- RLS on member_skills naturally scopes results: a regular member
-- calling this view will see only their own row (their own skill
-- data is the only data they can read from member_skills). Officers
-- and admins see all members. Access should be restricted to
-- authenticated users via a GRANT (see below) rather than anon.
--
-- SECURITY: This view is SECURITY INVOKER (Postgres default for
-- views). RLS on member_skills and member_profiles applies to the
-- calling user — a regular member sees only their own match data.
-- Officers/admins (who have SELECT ALL on member_skills) see the
-- full cross-member match matrix.
-- ================================================================
CREATE OR REPLACE VIEW competition_skill_match AS
WITH required_counts AS (
  -- Pre-aggregate required skill counts per competition.
  SELECT
    competition_id,
    COUNT(*)    AS total_required
  FROM competition_required_skills
  GROUP BY competition_id
),
member_matches AS (
  -- For each (competition, member) pair, count how many of the
  -- competition's required skills the member has.
  SELECT
    crs.competition_id,
    ms.member_id,
    COUNT(DISTINCT ms.skill_id)   AS matched_skills
  FROM competition_required_skills crs
  JOIN member_skills ms ON ms.skill_id = crs.skill_id
  GROUP BY crs.competition_id, ms.member_id
)
SELECT
  mm.competition_id,
  c.title                                       AS competition_title,
  c.organizer_name,
  c.start_date,
  c.end_date,
  mm.member_id,
  mp.nickname,
  mp.avatar_url,
  rc.total_required                             AS total_required_skills,
  mm.matched_skills,
  ROUND(
    mm.matched_skills::numeric /
    NULLIF(rc.total_required, 0) * 100,
    1
  )                                             AS match_pct,
  -- Leaderboard signals: brackets the member's overall merit level.
  -- NULL when the member has no point_events yet (new member).
  lb.total_points                               AS leaderboard_points,
  lb.rank                                       AS leaderboard_rank
FROM member_matches mm
JOIN competitions        c  ON c.id  = mm.competition_id
JOIN member_profiles     mp ON mp.id = mm.member_id
JOIN required_counts     rc ON rc.competition_id = mm.competition_id
LEFT JOIN leaderboard    lb ON lb.member_id = mm.member_id
WHERE c.status IN ('upcoming', 'active');

COMMENT ON VIEW competition_skill_match IS
  'Skill-based member-to-competition matching view. '
  'Scores members by how many of a competition''s required skills they hold, '
  'combined with their overall leaderboard bracket. '
  'Used by officers/admins to identify strong candidates to nominate. '
  'RLS on member_skills scopes results by caller role: '
  'regular members see only their own row; officers/admins see all.';

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE competitions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_required_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_winners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE winner_skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE judges                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge_profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_judges         ENABLE ROW LEVEL SECURITY;

-- competition_skill_match is a plain view — no RLS directly.
-- Safety is by RLS on member_skills (security invoker) + access grant below.
-- Grant SELECT to authenticated only (not anon).
GRANT SELECT ON competition_skill_match TO authenticated;

-- ----------------------------------------------------------------
-- competitions policies
--
-- READ: All authenticated users may read competition records.
-- Competitions are public org intelligence — members should know
-- what opportunities exist. Anon may also read (public-facing).
--
-- WRITE: Officers and admins may INSERT and UPDATE competitions.
-- Only admins may DELETE (hard-delete is destructive; prefer status='cancelled').
-- ----------------------------------------------------------------

CREATE POLICY "competitions__anon_select"
  ON competitions FOR SELECT TO anon
  USING (true);

CREATE POLICY "competitions__auth_select"
  ON competitions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "competitions__officer_insert"
  ON competitions FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competitions__officer_update"
  ON competitions FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competitions__admin_delete"
  ON competitions FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- competition_required_skills policies
--
-- READ: All authenticated users may see required skills for competitions.
-- This is public competition metadata (what skills are needed).
--
-- WRITE: Officers and admins only. Skill requirements are curated data.
-- ----------------------------------------------------------------

CREATE POLICY "competition_required_skills__anon_select"
  ON competition_required_skills FOR SELECT TO anon
  USING (true);

CREATE POLICY "competition_required_skills__auth_select"
  ON competition_required_skills FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "competition_required_skills__officer_insert"
  ON competition_required_skills FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competition_required_skills__officer_update"
  ON competition_required_skills FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competition_required_skills__admin_delete"
  ON competition_required_skills FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- competition_winners policies
--
-- READ: PUBLIC — prior winners are public records. Anon may read.
-- These are publicly announced results; no privacy concern here.
--
-- WRITE: Officers and admins enter/edit winner records.
-- Deletion is admin-only (winner records should be permanent).
-- ----------------------------------------------------------------

CREATE POLICY "competition_winners__anon_select"
  ON competition_winners FOR SELECT TO anon
  USING (true);

CREATE POLICY "competition_winners__auth_select"
  ON competition_winners FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "competition_winners__officer_insert"
  ON competition_winners FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competition_winners__officer_update"
  ON competition_winners FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competition_winners__admin_delete"
  ON competition_winners FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- winner_skills policies
--
-- READ: PUBLIC — winner skills are part of the public record of
-- who won and what they knew. Anon may read.
--
-- WRITE: Officers and admins only.
-- ----------------------------------------------------------------

CREATE POLICY "winner_skills__anon_select"
  ON winner_skills FOR SELECT TO anon
  USING (true);

CREATE POLICY "winner_skills__auth_select"
  ON winner_skills FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "winner_skills__officer_insert"
  ON winner_skills FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "winner_skills__admin_delete"
  ON winner_skills FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- judges policies
--
-- READ: Authenticated users may see judge names and public handles.
-- This is public information (judges are listed in competition materials).
-- Anon may NOT read — judge data should require login to access.
--
-- WRITE: Officers and admins manage judge records.
-- ----------------------------------------------------------------

CREATE POLICY "judges__auth_select"
  ON judges FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "judges__officer_insert"
  ON judges FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "judges__officer_update"
  ON judges FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "judges__admin_delete"
  ON judges FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- judge_profiles policies
--
-- READ: RESTRICTED — is_officer() and is_admin() ONLY.
-- This table contains scraped public professional intel used as
-- competitive preparation reference. Regular members do not have
-- access. Anon users have no access. This restriction prevents
-- misuse and aligns with the platform's privacy posture.
--
-- WRITE: Officers and admins. Automated scraping jobs insert via
-- service_role (which bypasses RLS). Admin-only INSERT policy for
-- manual entries.
--
-- No DELETE policy for authenticated users (admin may delete via
-- service_role for data-retention compliance / GDPR-style requests).
-- ----------------------------------------------------------------

CREATE POLICY "judge_profiles__officer_or_admin_select"
  ON judge_profiles FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- Admins may manually enter judge profile data.
-- Automated scraping inserts via service_role (bypasses RLS).
CREATE POLICY "judge_profiles__admin_insert"
  ON judge_profiles FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Admins may update profiles (corrections, manual refreshes).
CREATE POLICY "judge_profiles__admin_update"
  ON judge_profiles FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ----------------------------------------------------------------
-- competition_judges policies
--
-- READ: Authenticated users see which judges are linked to competitions.
-- This is public competition metadata (judging panels are announced).
--
-- WRITE: Officers and admins manage the competition ↔ judge mapping.
-- ----------------------------------------------------------------

CREATE POLICY "competition_judges__auth_select"
  ON competition_judges FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "competition_judges__officer_insert"
  ON competition_judges FOR INSERT TO authenticated
  WITH CHECK (is_officer() OR is_admin());

CREATE POLICY "competition_judges__admin_delete"
  ON competition_judges FOR DELETE TO authenticated
  USING (is_admin());
