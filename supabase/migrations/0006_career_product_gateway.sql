-- Career product data exposed through the authenticated product_view RPC.
-- Raw browser/session data, credentials, DOM snapshots, and questionnaire answers do not belong here.

CREATE TYPE evidence_verification_state AS ENUM ('verified', 'ready', 'blocked');
CREATE TYPE connection_state AS ENUM ('connected', 'disconnected', 'verification_required');

CREATE OR REPLACE FUNCTION public.create_member_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.member_profiles (id, display_name)
  VALUES (NEW.id, NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_member_profile_for_auth_user();

CREATE TABLE career_evidence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
  source_kind text NOT NULL CHECK (source_kind IN ('project', 'post', 'document', 'academic', 'manual')),
  verification_state evidence_verification_state NOT NULL DEFAULT 'ready',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE career_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id uuid REFERENCES career_evidence_sources(id) ON DELETE SET NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('experience', 'project', 'skill', 'education', 'award', 'certification', 'publication')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  normalized_value text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resume_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id text NOT NULL,
  label text NOT NULL,
  summary text NOT NULL DEFAULT '',
  skill_group_count integer NOT NULL DEFAULT 0 CHECK (skill_group_count >= 0),
  project_count integer NOT NULL DEFAULT 0 CHECK (project_count >= 0),
  artifact_ready boolean NOT NULL DEFAULT false,
  storage_objects jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(storage_objects) = 'array'),
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

CREATE TABLE application_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Application goal',
  target integer NOT NULL CHECK (target > 0),
  completed integer NOT NULL DEFAULT 0 CHECK (completed >= 0 AND completed <= target),
  active_workers integer NOT NULL DEFAULT 0 CHECK (active_workers >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES application_goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'waiting',
  human_gate boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company text NOT NULL,
  job_title text NOT NULL,
  location text NOT NULL DEFAULT '',
  work_mode text NOT NULL DEFAULT 'unknown' CHECK (work_mode IN ('remote', 'hybrid', 'onsite', 'any', 'unknown')),
  funnel_stage text NOT NULL DEFAULT 'discovered',
  fit_score integer CHECK (fit_score BETWEEN 0 AND 100),
  source_domain text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connection_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('identity', 'social', 'job_site', 'database')),
  state connection_state NOT NULL DEFAULT 'disconnected',
  detail text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider_key)
);

CREATE TABLE feature_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability text NOT NULL,
  domain text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  granted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, capability, domain)
);

CREATE TABLE career_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_value numeric NOT NULL,
  detail text NOT NULL DEFAULT '',
  measured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric_key)
);

CREATE INDEX idx_career_evidence_sources_user ON career_evidence_sources(user_id, verification_state);
CREATE INDEX idx_career_evidence_items_user ON career_evidence_items(user_id, evidence_kind);
CREATE INDEX idx_resume_artifacts_user ON resume_artifacts(user_id, generated_at DESC);
CREATE INDEX idx_application_goals_user ON application_goals(user_id, updated_at DESC);
CREATE INDEX idx_application_reviews_user ON application_review_items(user_id, state, created_at DESC);
CREATE INDEX idx_market_opportunities_user ON market_opportunities(user_id, funnel_stage, updated_at DESC);
CREATE INDEX idx_connection_summaries_user ON connection_summaries(user_id, category);
CREATE INDEX idx_career_metrics_user ON career_metrics(user_id, metric_key);

CREATE TRIGGER trg_career_evidence_sources_updated_at BEFORE UPDATE ON career_evidence_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_career_evidence_items_updated_at BEFORE UPDATE ON career_evidence_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_resume_artifacts_updated_at BEFORE UPDATE ON resume_artifacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_application_goals_updated_at BEFORE UPDATE ON application_goals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_application_review_items_updated_at BEFORE UPDATE ON application_review_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_market_opportunities_updated_at BEFORE UPDATE ON market_opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_feature_permissions_updated_at BEFORE UPDATE ON feature_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE career_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY career_evidence_sources_owner_select ON career_evidence_sources FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY career_evidence_items_owner_select ON career_evidence_items FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY resume_artifacts_owner_select ON resume_artifacts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY application_goals_owner_select ON application_goals FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY application_review_items_owner_select ON application_review_items FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY market_opportunities_owner_select ON market_opportunities FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY connection_summaries_owner_select ON connection_summaries FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY feature_permissions_owner_select ON feature_permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY career_metrics_owner_select ON career_metrics FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('resume-artifacts', 'resume-artifacts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY resume_storage_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resume-artifacts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE OR REPLACE FUNCTION product_view(requested_view text, requested_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  heading jsonb;
  source_count integer;
  resume_count integer;
  opportunity_count integer;
  review_count integer;
BEGIN
  IF requested_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'product view access denied';
  END IF;
  IF requested_view NOT IN ('dashboard', 'career-evidence', 'resumes', 'job-operations', 'opportunities', 'connections', 'advisor') THEN
    RAISE EXCEPTION 'unsupported product view';
  END IF;

  heading := CASE requested_view
    WHEN 'career-evidence' THEN jsonb_build_object('eyebrow','Normalized career database','title','Career Evidence','description','Approved sources and reusable verified facts from the retrieval middleman.')
    WHEN 'resumes' THEN jsonb_build_object('eyebrow','Generated outputs','title','Resume Studio','description','Role-specific artifacts generated from normalized career evidence.')
    WHEN 'job-operations' THEN jsonb_build_object('eyebrow','Human-gated execution','title','Job Automation','description','Goals, safe work, and items waiting for explicit approval.')
    WHEN 'opportunities' THEN jsonb_build_object('eyebrow','Evidence-backed market fit','title','Opportunities & Interviews','description','Qualification signals and funnel progress without invented evidence.')
    WHEN 'connections' THEN jsonb_build_object('eyebrow','Access and identity','title','Connections & Sessions','description','Sanitized connection health without credentials or browser state.')
    WHEN 'advisor' THEN jsonb_build_object('eyebrow','Grounded recommendations','title','Career Advisor','description','Recommendations constrained to cited, normalized career evidence.')
    ELSE jsonb_build_object('eyebrow','Career command center','title','Your career system, at a glance.','description','Verified evidence, resumes, opportunities, and permission-gated automation.')
  END;

  SELECT count(*) INTO source_count FROM career_evidence_sources WHERE user_id = requested_user_id;
  SELECT count(*) FILTER (WHERE artifact_ready) INTO resume_count FROM resume_artifacts WHERE user_id = requested_user_id;
  SELECT count(*) INTO opportunity_count FROM market_opportunities WHERE user_id = requested_user_id;
  SELECT count(*) INTO review_count FROM application_review_items WHERE user_id = requested_user_id;

  RETURN jsonb_build_object(
    'heading', heading,
    'stats', jsonb_build_array(
      jsonb_build_object('label','Evidence sources','value',source_count::text,'detail','Owner-scoped normalized inputs'),
      jsonb_build_object('label','Resume artifacts','value',resume_count::text,'detail','Role-specific outputs'),
      jsonb_build_object('label','Opportunities','value',opportunity_count::text,'detail','Persisted market records'),
      jsonb_build_object('label','Human reviews','value',review_count::text,'detail','Never auto-approved')
    ),
    'evidence', jsonb_build_object(
      'ready', source_count > 0,
      'phase', CASE WHEN source_count > 0 THEN 'ready' ELSE 'setup' END,
      'profileFacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('label',evidence_kind,'value',label) ORDER BY created_at DESC) FROM (SELECT * FROM career_evidence_items WHERE user_id=requested_user_id AND is_verified LIMIT 8) facts), '[]'::jsonb),
      'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'kind',source_kind,'status',verification_state) ORDER BY created_at DESC) FROM career_evidence_sources WHERE user_id=requested_user_id), '[]'::jsonb),
      'skills', COALESCE((SELECT jsonb_agg(label ORDER BY label) FROM career_evidence_items WHERE user_id=requested_user_id AND evidence_kind='skill' AND is_verified), '[]'::jsonb),
      'blockers', '[]'::jsonb
    ),
    'resumes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',role_id,'label',label,'summary',summary,'skillGroupCount',skill_group_count,'projectCount',project_count,'ready',artifact_ready,'formats',storage_objects) ORDER BY generated_at DESC) FROM resume_artifacts WHERE user_id=requested_user_id), '[]'::jsonb),
    'operations', COALESCE((SELECT jsonb_build_object('goalLabel',label,'completed',completed,'target',target,'activeWorkers',active_workers,'reviews',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'detail',detail,'state',state,'humanGate',human_gate) ORDER BY created_at DESC) FROM application_review_items WHERE user_id=requested_user_id AND state NOT IN ('resolved','dismissed')), '[]'::jsonb)) FROM application_goals WHERE user_id=requested_user_id ORDER BY updated_at DESC LIMIT 1), jsonb_build_object('goalLabel','Application goal','completed',0,'target',0,'activeWorkers',0,'reviews','[]'::jsonb)),
    'opportunities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'company',company,'title',job_title,'location',location,'workMode',work_mode,'stage',funnel_stage,'fit',fit_score) ORDER BY updated_at DESC) FROM market_opportunities WHERE user_id=requested_user_id), '[]'::jsonb),
    'connections', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',provider_key,'label',label,'category',category,'status',state,'detail',detail) ORDER BY category,label) FROM connection_summaries WHERE user_id=requested_user_id), '[]'::jsonb),
    'recommendations', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION product_view(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_view(text, uuid) TO authenticated;
