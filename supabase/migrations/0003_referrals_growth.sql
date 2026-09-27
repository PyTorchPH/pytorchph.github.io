-- ================================================================
-- Migration 0003: Referrals & Growth Track
--
-- Depends on: 0001_org_activities.sql, 0002_points_leaderboard.sql
--   - member_profiles, activities, clusters (from prior migrations)
--   - is_admin() helper function
--
-- DOMAIN A — REFERRALS:
--   Records member-to-member referrals with points awarded.
--   Hard constraint prevents self-referral. One referral per pair.
--
-- DOMAIN B — GROWTH TRACK (DIAGNOSTIC ENGINE, NOT A LEADERBOARD):
--   This is deliberately NOT a second leaderboard. It is a
--   diagnostic tool: track learning gain (posttest − pretest)
--   and surface targeted recommendations for members who show
--   low points OR low gain. No point redistribution. No equity
--   adjustments. No score manipulation.
--
--   Tables:
--     activity_assessments   — pretest/posttest scores per member
--                              per activity; gain is computed.
--     growth_recommendations — maps low-gain/low-point members to
--                              relevant lessons, events, hackathons.
-- ================================================================

-- ================================================================
-- TABLE: referrals
-- Tracks who referred whom and the points awarded for the referral.
-- Points are credited via point_events (service_role), not here.
-- This table is the audit record only.
-- ================================================================
CREATE TABLE IF NOT EXISTS referrals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid        NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  referee_id      uuid        NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  points_awarded  numeric(10,2) NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
  awarded_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- A member cannot refer themselves.
  CONSTRAINT referrals_no_self_referral CHECK (referrer_id != referee_id),

  -- Each (referrer, referee) pair is unique: one referral credit per pair.
  CONSTRAINT referrals_unique_pair UNIQUE (referrer_id, referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee
  ON referrals (referee_id);
-- For checking if a referee has already been referred (prevents gaming).
CREATE INDEX IF NOT EXISTS idx_referrals_referee_awarded
  ON referrals (referee_id, awarded_at)
  WHERE awarded_at IS NOT NULL;

-- ================================================================
-- TABLE: activity_assessments
-- Stores pretest and posttest scores per member per activity.
-- The gain column is a stored generated column (posttest − pretest).
--
-- DIAGNOSTIC ONLY: gain is used to identify members who need
-- additional support. It does NOT generate extra points and does
-- NOT affect the leaderboard ranking.
-- ================================================================
CREATE TABLE IF NOT EXISTS activity_assessments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid        NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  activity_id     uuid        NOT NULL REFERENCES activities(id) ON DELETE CASCADE,

  -- Scores are 0–100. NULL means the test was not taken yet.
  pretest_score   numeric(5,2) CHECK (pretest_score  BETWEEN 0 AND 100),
  posttest_score  numeric(5,2) CHECK (posttest_score BETWEEN 0 AND 100),

  -- Stored generated column: posttest − pretest.
  -- NULL when either score is missing (member has not completed both).
  -- Negative gain is valid and meaningful (regression in performance).
  gain            numeric(5,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN pretest_score IS NOT NULL AND posttest_score IS NOT NULL
        THEN posttest_score - pretest_score
        ELSE NULL
      END
    ) STORED,

  assessed_at     timestamptz NOT NULL DEFAULT now(),

  -- One assessment record per (member, activity) pair.
  CONSTRAINT assessment_unique UNIQUE (member_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_assessments_member
  ON activity_assessments (member_id);
CREATE INDEX IF NOT EXISTS idx_activity_assessments_activity
  ON activity_assessments (activity_id);
-- For the recommendation engine: find members with low gain quickly.
CREATE INDEX IF NOT EXISTS idx_activity_assessments_gain
  ON activity_assessments (gain ASC NULLS LAST)
  WHERE gain IS NOT NULL;

-- ================================================================
-- ENUM: recommendation_type
-- Categories of targeted recommendations surfaced by the
-- diagnostic engine for members who show low points or low gain.
-- ================================================================
DO $$ BEGIN
  CREATE TYPE recommendation_type AS ENUM (
    'lesson',        -- self-paced learning material
    'event',         -- an upcoming org event to attend
    'hackathon',     -- a hackathon to join for applied practice
    'workshop',      -- a skill-building workshop
    'competition',   -- competitive programming / other competition
    'mentorship'     -- 1:1 mentoring from a higher-scoring member
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- TABLE: growth_recommendations
--
-- PURPOSE: Diagnostic engine output only. Maps low-scoring or
-- low-gain members to appropriate interventions.
--
-- NOT A LEADERBOARD SUPPLEMENT. This table:
--   - does NOT redistribute points
--   - does NOT grant equity adjustments to low scorers
--   - does NOT change a member's leaderboard rank
--   - is PRIVATE to the member (owner-only RLS + admins)
--
-- The recommendation engine (Edge Function / AI pipeline) writes
-- here after analyzing activity_assessments and point_events.
-- Members can dismiss recommendations they've already acted on.
-- ================================================================
CREATE TABLE IF NOT EXISTS growth_recommendations (
  id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           uuid                NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  recommendation_type recommendation_type NOT NULL,
  title               text                NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description         text,

  -- Human-readable reason surfacing why this was recommended.
  -- Example: "Low average gain (-12 pts) in competitive_programming activities."
  reason              text                NOT NULL,

  -- Optional links to an existing activity or cluster.
  activity_id         uuid                REFERENCES activities(id) ON DELETE SET NULL,
  cluster_id          uuid                REFERENCES clusters(id) ON DELETE SET NULL,

  -- Member can dismiss recommendations they've acted on.
  is_dismissed        boolean             NOT NULL DEFAULT false,
  dismissed_at        timestamptz,

  created_at          timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT dismissed_has_timestamp
    CHECK (NOT is_dismissed OR dismissed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_growth_recommendations_member
  ON growth_recommendations (member_id);
-- Recommendation engine: surface undismissed recommendations efficiently.
CREATE INDEX IF NOT EXISTS idx_growth_recommendations_active
  ON growth_recommendations (member_id, recommendation_type)
  WHERE is_dismissed = false;

-- ================================================================
-- DIAGNOSTIC VIEW: member_growth_summary
-- A non-materialized view providing per-member gain analytics.
-- Used by the recommendation engine and admin dashboards.
-- NOT exposed to end users directly (no public RLS grant).
--
-- DIAGNOSTIC ONLY — no points are derived from this view.
-- ================================================================
CREATE OR REPLACE VIEW member_growth_summary AS
SELECT
  aa.member_id,
  a.category,
  COUNT(*)                         AS assessment_count,
  ROUND(AVG(aa.gain), 2)           AS avg_gain,
  ROUND(MIN(aa.gain), 2)           AS min_gain,
  ROUND(MAX(aa.gain), 2)           AS max_gain,
  COUNT(*) FILTER (WHERE aa.gain < 0)  AS regression_count,
  COUNT(*) FILTER (WHERE aa.gain > 10) AS strong_gain_count
FROM   activity_assessments aa
JOIN   activities a ON a.id = aa.activity_id
WHERE  aa.gain IS NOT NULL
GROUP  BY aa.member_id, a.category;

COMMENT ON VIEW member_growth_summary IS
  'Diagnostic-only aggregate view. Used by the recommendation engine '
  'to identify members with low or negative learning gain. '
  'Does not affect points, ranks, or leaderboard standings.';

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE referrals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_assessments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_recommendations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- referrals policies
-- Referrer sees their own sent referrals.
-- Referee sees referrals where they are the referee.
-- Admins see all.
-- Referrals are created by service_role (no client INSERT).
-- ----------------------------------------------------------------

CREATE POLICY "referrals__referrer_select"
  ON referrals FOR SELECT TO authenticated
  USING (referrer_id = (SELECT auth.uid()));

CREATE POLICY "referrals__referee_select"
  ON referrals FOR SELECT TO authenticated
  USING (referee_id = (SELECT auth.uid()));

CREATE POLICY "referrals__admin_select"
  ON referrals FOR SELECT TO authenticated
  USING (is_admin());

-- Admins can manually create referral records (e.g. retroactive credits).
CREATE POLICY "referrals__admin_insert"
  ON referrals FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Referrals are immutable once created (no UPDATE/DELETE for members).

-- ----------------------------------------------------------------
-- activity_assessments policies
-- PRIVATE: members see only their own assessments (diagnostic data).
-- Admins see all.
-- Assessments are created by service_role (test infrastructure).
-- ----------------------------------------------------------------

CREATE POLICY "activity_assessments__owner_select"
  ON activity_assessments FOR SELECT TO authenticated
  USING (member_id = (SELECT auth.uid()));

CREATE POLICY "activity_assessments__admin_select"
  ON activity_assessments FOR SELECT TO authenticated
  USING (is_admin());

-- Members may submit their own pretest/posttest scores
-- (e.g. self-reported or from an in-app quiz).
CREATE POLICY "activity_assessments__owner_insert"
  ON activity_assessments FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT auth.uid()));

-- Members can update their own assessment (e.g. fill in posttest score).
CREATE POLICY "activity_assessments__owner_update"
  ON activity_assessments FOR UPDATE TO authenticated
  USING  (member_id = (SELECT auth.uid()))
  WITH CHECK (member_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------
-- growth_recommendations policies
-- PRIVATE: members see and dismiss only their own recommendations.
-- The recommendation engine writes via service_role.
-- ----------------------------------------------------------------

CREATE POLICY "growth_recommendations__owner_select"
  ON growth_recommendations FOR SELECT TO authenticated
  USING (member_id = (SELECT auth.uid()));

-- Members may dismiss their own recommendations.
CREATE POLICY "growth_recommendations__owner_dismiss"
  ON growth_recommendations FOR UPDATE TO authenticated
  USING  (member_id = (SELECT auth.uid()))
  WITH CHECK (
    member_id = (SELECT auth.uid())
    -- Only dismiss action is allowed from client:
    -- is_dismissed must be set to true and dismissed_at must be present.
    AND is_dismissed = true
    AND dismissed_at IS NOT NULL
  );

CREATE POLICY "growth_recommendations__admin_select"
  ON growth_recommendations FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "growth_recommendations__admin_insert"
  ON growth_recommendations FOR INSERT TO authenticated
  WITH CHECK (is_admin());
