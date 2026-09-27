-- Authenticated seasonal leaderboards and owner-only member command center.
-- Raw ranking relations remain internal; browser clients use the JSON RPC projections below.

DO $$ BEGIN
  CREATE TYPE leaderboard_identity_mode AS ENUM ('nickname', 'anonymous', 'real_name');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE leaderboard_season_state AS ENUM ('planned', 'active', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS leaderboard_username text,
  ADD COLUMN IF NOT EXISTS leaderboard_identity leaderboard_identity_mode NOT NULL DEFAULT 'nickname',
  ADD COLUMN IF NOT EXISTS real_name_leaderboard_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leaderboard_username_review_required boolean NOT NULL DEFAULT true;

ALTER TABLE member_profiles ALTER COLUMN leaderboard_username
  SET DEFAULT ('member-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));

UPDATE member_profiles
SET leaderboard_username = 'member-' || upper(substr(md5(id::text), 1, 8))
WHERE leaderboard_username IS NULL;

ALTER TABLE member_profiles
  ALTER COLUMN leaderboard_username SET NOT NULL;

CREATE OR REPLACE FUNCTION public.create_member_profile_for_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested text := NULLIF(trim(NEW.raw_user_meta_data ->> 'leaderboard_username'), '');
BEGIN
  INSERT INTO public.member_profiles (
    id, display_name, leaderboard_username, nickname, leaderboard_username_review_required
  ) VALUES (
    NEW.id,
    NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''),
    CASE WHEN requested ~ '^[A-Za-z0-9_-]{3,24}$' THEN requested ELSE 'member-' || upper(substr(md5(NEW.id::text), 1, 8)) END,
    CASE WHEN requested ~ '^[A-Za-z0-9_-]{3,24}$' THEN requested ELSE NULL END,
    NOT COALESCE(requested ~ '^[A-Za-z0-9_-]{3,24}$', false)
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  ALTER TABLE member_profiles ADD CONSTRAINT leaderboard_username_format
    CHECK (leaderboard_username ~ '^[A-Za-z0-9_-]{3,24}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_leaderboard_username_ci
  ON member_profiles (lower(leaderboard_username));

CREATE TABLE IF NOT EXISTS leaderboard_rank_policies (
  version integer PRIMARY KEY CHECK (version > 0),
  label text NOT NULL,
  published_at timestamptz,
  published_by uuid REFERENCES member_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((published_at IS NULL) = (published_by IS NULL))
);

CREATE TABLE IF NOT EXISTS leaderboard_rank_thresholds (
  policy_version integer NOT NULL REFERENCES leaderboard_rank_policies(version) ON DELETE CASCADE,
  minimum_points numeric(12,2) NOT NULL CHECK (minimum_points >= 0),
  tier text NOT NULL CHECK (tier IN ('Bronze','Silver','Gold','Platinum','Diamond','Master')),
  division text NOT NULL CHECK (division IN ('III','II','I')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 17),
  PRIMARY KEY (policy_version, ordinal),
  UNIQUE (policy_version, minimum_points),
  UNIQUE (policy_version, tier, division)
);

INSERT INTO leaderboard_rank_policies (version, label)
VALUES (1, 'Demo 250-point ladder — officer publication required')
ON CONFLICT (version) DO NOTHING;

INSERT INTO leaderboard_rank_thresholds (policy_version, minimum_points, tier, division, ordinal)
SELECT 1, ordinal * 250,
  (ARRAY['Bronze','Silver','Gold','Platinum','Diamond','Master'])[1 + ordinal / 3],
  (ARRAY['III','II','I'])[1 + ordinal % 3], ordinal
FROM generate_series(0, 17) AS ordinal
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS leaderboard_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  label text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state leaderboard_season_state NOT NULL DEFAULT 'planned',
  rank_policy_version integer NOT NULL REFERENCES leaderboard_rank_policies(version),
  archived_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (state <> 'completed' OR archived_at IS NOT NULL)
);

-- Calendar boundaries are midnight in Asia/Manila (UTC+8).
INSERT INTO leaderboard_seasons (slug, label, starts_at, ends_at, state, rank_policy_version)
VALUES
  ('2026-q3', '2026 Quarter 3', '2026-06-30 16:00:00+00', '2026-09-30 16:00:00+00', 'active', 1),
  ('2026-q4', '2026 Quarter 4', '2026-09-30 16:00:00+00', '2026-12-31 16:00:00+00', 'planned', 1)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS leaderboard_anonymous_aliases (
  season_id uuid NOT NULL REFERENCES leaderboard_seasons(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (alias ~ '^Member #[A-F0-9]{5}$'),
  PRIMARY KEY (season_id, member_id),
  UNIQUE (season_id, alias)
);

INSERT INTO leaderboard_anonymous_aliases (season_id, member_id, alias)
SELECT s.id, mp.id, 'Member #' || upper(substr(md5(s.id::text || ':' || mp.id::text), 1, 5))
FROM leaderboard_seasons s CROSS JOIN member_profiles mp
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_leaderboard_aliases()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='leaderboard_seasons' THEN
    INSERT INTO leaderboard_anonymous_aliases(season_id,member_id,alias)
    SELECT NEW.id,mp.id,'Member #'||upper(substr(md5(NEW.id::text||':'||mp.id::text),1,5)) FROM member_profiles mp ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO leaderboard_anonymous_aliases(season_id,member_id,alias)
    SELECT s.id,NEW.id,'Member #'||upper(substr(md5(s.id::text||':'||NEW.id::text),1,5)) FROM leaderboard_seasons s ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seed_aliases_for_season AFTER INSERT ON leaderboard_seasons FOR EACH ROW EXECUTE FUNCTION seed_leaderboard_aliases();
CREATE TRIGGER seed_aliases_for_member AFTER INSERT ON member_profiles FOR EACH ROW EXECUTE FUNCTION seed_leaderboard_aliases();

CREATE TABLE IF NOT EXISTS leaderboard_season_snapshots (
  season_id uuid NOT NULL REFERENCES leaderboard_seasons(id) ON DELETE RESTRICT,
  skill_slug text NOT NULL DEFAULT '',
  member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE RESTRICT,
  rank integer NOT NULL CHECK (rank > 0),
  points numeric(12,2) NOT NULL CHECK (points >= 0),
  source_diversity integer NOT NULL CHECK (source_diversity >= 0),
  attained_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  streak integer NOT NULL CHECK (streak >= 0),
  tier text NOT NULL,
  division text NOT NULL,
  verified_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (season_id, skill_slug, member_id)
);

CREATE OR REPLACE FUNCTION reject_leaderboard_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'completed leaderboard snapshots are immutable'; END; $$;
CREATE TRIGGER leaderboard_snapshots_immutable BEFORE UPDATE OR DELETE ON leaderboard_season_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_leaderboard_snapshot_mutation();

ALTER TABLE leaderboard_rank_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_rank_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_anonymous_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_season_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON leaderboard FROM anon, authenticated;
REVOKE ALL ON skill_leaderboard FROM anon, authenticated;
REVOKE SELECT ON member_profiles FROM anon;
REVOKE UPDATE ON member_profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url, bio) ON member_profiles TO authenticated;
REVOKE ALL ON leaderboard_rank_policies, leaderboard_rank_thresholds, leaderboard_seasons,
  leaderboard_anonymous_aliases, leaderboard_season_snapshots FROM anon, authenticated;

CREATE OR REPLACE FUNCTION leaderboard_username_available(candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT candidate ~ '^[A-Za-z0-9_-]{3,24}$'
    AND NOT EXISTS (
      SELECT 1 FROM member_profiles
      WHERE lower(leaderboard_username) = lower(candidate)
        AND id IS DISTINCT FROM (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION update_leaderboard_identity(
  requested_username text,
  requested_mode leaderboard_identity_mode,
  requested_real_name_consent boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE profile member_profiles%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF requested_username !~ '^[A-Za-z0-9_-]{3,24}$' THEN RAISE EXCEPTION 'invalid leaderboard username'; END IF;
  IF EXISTS (SELECT 1 FROM member_profiles WHERE lower(leaderboard_username)=lower(requested_username) AND id<>(SELECT auth.uid())) THEN
    RAISE EXCEPTION 'leaderboard username unavailable';
  END IF;
  IF requested_mode = 'real_name' AND requested_real_name_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'real-name visibility requires explicit consent';
  END IF;
  UPDATE member_profiles SET
    leaderboard_username=requested_username,
    nickname=requested_username,
    leaderboard_identity=CASE WHEN requested_mode='real_name' AND NOT requested_real_name_consent THEN 'nickname' ELSE requested_mode END,
    real_name_leaderboard_consent=requested_real_name_consent,
    leaderboard_username_review_required=false
  WHERE id=(SELECT auth.uid()) RETURNING * INTO profile;
  RETURN jsonb_build_object(
    'username', profile.leaderboard_username,
    'mode', profile.leaderboard_identity,
    'realNameConsent', profile.real_name_leaderboard_consent,
    'reviewRequired', profile.leaderboard_username_review_required,
    'preview', CASE
      WHEN profile.leaderboard_identity='anonymous' THEN 'Season-scoped anonymous label'
      WHEN profile.leaderboard_identity='real_name' AND profile.real_name_leaderboard_consent THEN profile.display_name
      ELSE profile.leaderboard_username END
  );
END;
$$;

CREATE OR REPLACE FUNCTION leaderboard_identity_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'username', leaderboard_username,
    'mode', leaderboard_identity,
    'realNameConsent', real_name_leaderboard_consent,
    'reviewRequired', leaderboard_username_review_required,
    'preview', CASE
      WHEN leaderboard_identity='anonymous' THEN 'Season-scoped anonymous label'
      WHEN leaderboard_identity='real_name' AND real_name_leaderboard_consent THEN display_name
      ELSE leaderboard_username END
  ) FROM member_profiles WHERE id=(SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION member_leaderboard(
  requested_season text DEFAULT NULL,
  requested_skill text DEFAULT NULL,
  requested_page integer DEFAULT 1,
  requested_page_size integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE selected leaderboard_seasons%ROWTYPE; result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF requested_page < 1 OR requested_page_size < 1 OR requested_page_size > 100 THEN RAISE EXCEPTION 'invalid pagination'; END IF;
  SELECT * INTO selected FROM leaderboard_seasons
  WHERE slug=COALESCE(requested_season, (SELECT slug FROM leaderboard_seasons WHERE state='active' ORDER BY starts_at DESC LIMIT 1))
    AND state IN ('active','completed');
  IF selected.id IS NULL THEN RAISE EXCEPTION 'season not found'; END IF;

  IF selected.state='completed' THEN
    SELECT jsonb_build_object(
      'season',jsonb_build_object('slug',selected.slug,'label',selected.label,'state',selected.state,'startsAt',selected.starts_at,'endsAt',selected.ends_at),
      'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rank',ss.rank,
        'displayLabel',CASE WHEN mp.leaderboard_identity='anonymous' THEN aa.alias WHEN mp.leaderboard_identity='real_name' AND mp.real_name_leaderboard_consent THEN mp.display_name ELSE mp.leaderboard_username END,
        'points',ss.points,'streak',ss.streak,'tier',ss.tier,'division',ss.division,'verifiedSkills',ss.verified_skills,'isCurrentUser',ss.member_id=(SELECT auth.uid())
      ) ORDER BY ss.rank) FROM (SELECT * FROM leaderboard_season_snapshots WHERE season_id=selected.id AND skill_slug=COALESCE(requested_skill,'') ORDER BY rank OFFSET (requested_page-1)*requested_page_size LIMIT requested_page_size) ss JOIN member_profiles mp ON mp.id=ss.member_id LEFT JOIN leaderboard_anonymous_aliases aa ON aa.season_id=selected.id AND aa.member_id=ss.member_id),'[]'::jsonb),
      'page',requested_page,'pageSize',requested_page_size,
      'total',(SELECT count(*) FROM leaderboard_season_snapshots WHERE season_id=selected.id AND skill_slug=COALESCE(requested_skill,'')),
      'skills',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',display_name) ORDER BY display_name) FROM skills WHERE status='approved'),'[]'::jsonb),
      'seasons',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',label,'state',state) ORDER BY starts_at DESC) FROM leaderboard_seasons WHERE state IN ('active','completed')),'[]'::jsonb)
    ) INTO result;
    RETURN result;
  END IF;

  WITH eligible AS (
    SELECT pe.member_id,
      SUM(pe.weighted_points)::numeric(12,2) points,
      COUNT(DISTINCT pe.source)::integer source_diversity,
      MAX(pe.earned_at) attained_at,
      MAX(pe.created_at) last_activity_at,
      COUNT(DISTINCT date_trunc('week', pe.earned_at AT TIME ZONE 'Asia/Manila'))::integer streak
    FROM point_events pe
    WHERE pe.earned_at >= selected.starts_at AND pe.earned_at < selected.ends_at
      AND (requested_skill IS NULL OR EXISTS (
        SELECT 1 FROM point_event_skills pes JOIN skills s ON s.id=pes.skill_id
        WHERE pes.point_event_id=pe.id AND s.status='approved' AND s.slug=requested_skill))
    GROUP BY pe.member_id
  ), ranked AS (
    SELECT e.*, row_number() OVER (ORDER BY e.points DESC, e.source_diversity DESC, e.attained_at ASC, e.last_activity_at DESC, lower(mp.leaderboard_username) ASC)::integer rank
    FROM eligible e JOIN member_profiles mp ON mp.id=e.member_id
  ), projected AS (
    SELECT r.rank,
      CASE WHEN mp.leaderboard_identity='anonymous' THEN aa.alias
           WHEN mp.leaderboard_identity='real_name' AND mp.real_name_leaderboard_consent THEN mp.display_name
           ELSE mp.leaderboard_username END display_label,
      r.points, r.streak, mp.id=(SELECT auth.uid()) is_current_user,
      threshold.tier, threshold.division,
      COALESCE((SELECT jsonb_agg(name ORDER BY skill_points DESC, name) FROM (
        SELECT s.display_name name, SUM(pe2.weighted_points) skill_points
        FROM point_events pe2 JOIN point_event_skills pes ON pes.point_event_id=pe2.id
        JOIN skills s ON s.id=pes.skill_id AND s.status='approved'
        WHERE pe2.member_id=r.member_id AND pe2.earned_at>=selected.starts_at AND pe2.earned_at<selected.ends_at
        GROUP BY s.id,s.display_name ORDER BY skill_points DESC,s.display_name LIMIT 5
      ) top_skills), '[]'::jsonb) verified_skills
    FROM ranked r JOIN member_profiles mp ON mp.id=r.member_id
    LEFT JOIN leaderboard_anonymous_aliases aa ON aa.season_id=selected.id AND aa.member_id=r.member_id
    LEFT JOIN LATERAL (
      SELECT tier,division FROM leaderboard_rank_thresholds
      WHERE policy_version=selected.rank_policy_version AND minimum_points<=r.points
      ORDER BY minimum_points DESC LIMIT 1
    ) threshold ON true
  ), paged AS (
    SELECT * FROM projected ORDER BY rank OFFSET (requested_page-1)*requested_page_size LIMIT requested_page_size
  )
  SELECT jsonb_build_object(
    'season', jsonb_build_object('slug',selected.slug,'label',selected.label,'state',selected.state,'startsAt',selected.starts_at,'endsAt',selected.ends_at),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('rank',rank,'displayLabel',display_label,'points',points,'streak',streak,'tier',tier,'division',division,'verifiedSkills',verified_skills,'isCurrentUser',is_current_user) ORDER BY rank) FROM paged),'[]'::jsonb),
    'page',requested_page,'pageSize',requested_page_size,'total',(SELECT count(*) FROM projected),
    'skills',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',display_name) ORDER BY display_name) FROM skills WHERE status='approved'),'[]'::jsonb),
    'seasons',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',label,'state',state) ORDER BY starts_at DESC) FROM leaderboard_seasons WHERE state IN ('active','completed')),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION publish_leaderboard_rank_policy(requested_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer approval required'; END IF;
  IF (SELECT count(*) FROM leaderboard_rank_thresholds WHERE policy_version=requested_version) <> 18 THEN RAISE EXCEPTION 'rank policy must define all 18 divisions'; END IF;
  UPDATE leaderboard_rank_policies SET published_at=now(),published_by=(SELECT auth.uid()) WHERE version=requested_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'rank policy not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION archive_leaderboard_season(requested_season text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE selected leaderboard_seasons%ROWTYPE;
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer approval required'; END IF;
  SELECT * INTO selected FROM leaderboard_seasons WHERE slug=requested_season FOR UPDATE;
  IF selected.id IS NULL OR selected.state='completed' OR now()<selected.ends_at THEN RAISE EXCEPTION 'season cannot be archived'; END IF;
  IF NOT EXISTS (SELECT 1 FROM leaderboard_rank_policies WHERE version=selected.rank_policy_version AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'rank policy requires officer publication'; END IF;
  INSERT INTO leaderboard_season_snapshots (season_id,skill_slug,member_id,rank,points,source_diversity,attained_at,last_activity_at,streak,tier,division,verified_skills)
  WITH scopes AS (SELECT ''::text slug,NULL::uuid skill_id UNION ALL SELECT slug,id FROM skills WHERE status='approved'),
  aggregate AS (
    SELECT scopes.slug,pe.member_id,SUM(pe.weighted_points)::numeric(12,2) points,COUNT(DISTINCT pe.source)::integer source_diversity,MAX(pe.earned_at) attained_at,MAX(pe.created_at) last_activity_at,COUNT(DISTINCT date_trunc('week',pe.earned_at AT TIME ZONE 'Asia/Manila'))::integer streak
    FROM scopes JOIN point_events pe ON pe.earned_at>=selected.starts_at AND pe.earned_at<selected.ends_at
      AND (scopes.skill_id IS NULL OR EXISTS (SELECT 1 FROM point_event_skills pes WHERE pes.point_event_id=pe.id AND pes.skill_id=scopes.skill_id))
    GROUP BY scopes.slug,pe.member_id
  ), ranked AS (
    SELECT a.*,row_number() OVER (PARTITION BY a.slug ORDER BY a.points DESC,a.source_diversity DESC,a.attained_at ASC,a.last_activity_at DESC,lower(mp.leaderboard_username))::integer rank
    FROM aggregate a JOIN member_profiles mp ON mp.id=a.member_id
  )
  SELECT selected.id,r.slug,r.member_id,r.rank,r.points,r.source_diversity,r.attained_at,r.last_activity_at,r.streak,t.tier,t.division,
    COALESCE((SELECT jsonb_agg(name ORDER BY skill_points DESC,name) FROM (SELECT s.display_name name,SUM(pe.weighted_points) skill_points FROM point_events pe JOIN point_event_skills pes ON pes.point_event_id=pe.id JOIN skills s ON s.id=pes.skill_id AND s.status='approved' WHERE pe.member_id=r.member_id AND pe.earned_at>=selected.starts_at AND pe.earned_at<selected.ends_at GROUP BY s.id,s.display_name ORDER BY skill_points DESC,s.display_name LIMIT 5) x),'[]'::jsonb)
  FROM ranked r LEFT JOIN LATERAL (SELECT tier,division FROM leaderboard_rank_thresholds WHERE policy_version=selected.rank_policy_version AND minimum_points<=r.points ORDER BY minimum_points DESC LIMIT 1) t ON true;
  UPDATE leaderboard_seasons SET state='completed',archived_at=now() WHERE id=selected.id;
END;
$$;

CREATE OR REPLACE FUNCTION member_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE board jsonb; uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  board := member_leaderboard(NULL,NULL,1,100);
  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'verifiedEvidence',(SELECT count(*) FROM career_evidence_items WHERE user_id=uid AND is_verified),
      'readyResumes',(SELECT count(*) FROM resume_artifacts WHERE user_id=uid AND artifact_ready),
      'registeredEvents',0,
      'activeOpportunities',(SELECT count(*) FROM market_opportunities WHERE user_id=uid AND funnel_stage NOT IN ('rejected','withdrawn','confirmed')),
      'points',COALESCE((SELECT (entry->>'points')::numeric FROM jsonb_array_elements(board->'entries') entry WHERE (entry->>'isCurrentUser')::boolean),0),
      'rank',(SELECT (entry->>'rank')::integer FROM jsonb_array_elements(board->'entries') entry WHERE (entry->>'isCurrentUser')::boolean),
      'streak',COALESCE((SELECT (entry->>'streak')::integer FROM jsonb_array_elements(board->'entries') entry WHERE (entry->>'isCurrentUser')::boolean),0)
    ),
    'standing',(SELECT entry FROM jsonb_array_elements(board->'entries') entry WHERE (entry->>'isCurrentUser')::boolean),
    'activity',COALESCE((SELECT jsonb_agg(jsonb_build_object('week',week,'points',points) ORDER BY week) FROM (
      SELECT to_char(date_trunc('week',earned_at AT TIME ZONE 'Asia/Manila'),'Mon DD') week, SUM(weighted_points) points, date_trunc('week',earned_at AT TIME ZONE 'Asia/Manila') sort_week
      FROM point_events WHERE member_id=uid AND earned_at>=now()-interval '12 weeks' GROUP BY sort_week,week ORDER BY sort_week
    ) a),'[]'::jsonb),
    'skillPoints',COALESCE((SELECT jsonb_agg(jsonb_build_object('skill',display_name,'points',points) ORDER BY points DESC) FROM (
      SELECT s.display_name,SUM(pe.weighted_points) points FROM point_events pe JOIN point_event_skills pes ON pes.point_event_id=pe.id JOIN skills s ON s.id=pes.skill_id AND s.status='approved' WHERE pe.member_id=uid GROUP BY s.id,s.display_name LIMIT 8
    ) x),'[]'::jsonb),
    'opportunityStages',COALESCE((SELECT jsonb_agg(jsonb_build_object('stage',funnel_stage,'count',count) ORDER BY funnel_stage) FROM (SELECT funnel_stage,count(*) count FROM market_opportunities WHERE user_id=uid GROUP BY funnel_stage) x),'[]'::jsonb),
    'recommendations',jsonb_build_array('Verify another evidence source to strengthen skill coverage.','Review the next opportunity requiring a human decision.'),
    'community',jsonb_build_object(
      'activeMembers',(SELECT count(*) FROM member_profiles),
      'verifiedPointEvents',(SELECT count(*) FROM point_events),
      'reviewedEvidence',(SELECT count(*) FROM career_evidence_items WHERE is_verified),
      'freshness','Live Supabase projection'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION leaderboard_username_available(text), update_leaderboard_identity(text,leaderboard_identity_mode,boolean),
  leaderboard_identity_settings(), member_leaderboard(text,text,integer,integer), member_overview(), publish_leaderboard_rank_policy(integer), archive_leaderboard_season(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leaderboard_username_available(text), update_leaderboard_identity(text,leaderboard_identity_mode,boolean),
  leaderboard_identity_settings(), member_leaderboard(text,text,integer,integer), member_overview(), publish_leaderboard_rank_policy(integer), archive_leaderboard_season(text) TO authenticated;
