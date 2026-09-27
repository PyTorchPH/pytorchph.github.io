-- Privacy controls, one-click feedback, and officer-reviewed membership.
-- Supabase remains authoritative. Browser/device caches are never verification authorities.

DO $$ BEGIN
  CREATE TYPE membership_state AS ENUM ('prospective', 'payment_pending', 'active', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS membership_status membership_state NOT NULL DEFAULT 'prospective',
  ADD COLUMN IF NOT EXISTS membership_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS hide_google_identity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hide_real_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS device_cache_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS automatic_error_reports boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS product_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('member','officer')),
  category text NOT NULL CHECK (category IN ('bug','broken_flow','privacy','security','suggestion','automatic_error')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1200),
  route text NOT NULL CHECK (route LIKE '/%' AND length(route) <= 240),
  ui_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','triaged','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (jsonb_typeof(ui_state) = 'object')
);

CREATE TABLE IF NOT EXISTS membership_payment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  payment_reference text NOT NULL CHECK (length(payment_reference) BETWEEN 6 AND 80),
  proof_storage_path text NOT NULL CHECK (proof_storage_path !~ '^(https?://|data:)'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES member_profiles(id) ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '' CHECK (length(review_note) <= 500)
);

CREATE TABLE IF NOT EXISTS membership_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES member_profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('identity_created','payment_viewed','proof_submitted','activated','rejected')),
  identity_provider text CHECK (identity_provider IN ('email','google','microsoft',NULL)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_payment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_funnel_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON product_feedback, membership_payment_reviews, membership_funnel_events FROM anon, authenticated;
GRANT SELECT, INSERT ON product_feedback TO authenticated;
GRANT SELECT, INSERT ON membership_payment_reviews TO authenticated;

CREATE POLICY product_feedback_owner_insert ON product_feedback FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(ui_state) AS key
      WHERE key <> ALL (ARRAY['title','viewport','online','componentMarkers','error'])
    )
  );
CREATE POLICY product_feedback_owner_or_officer_select ON product_feedback FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()) OR is_officer() OR is_admin());
CREATE POLICY membership_payment_owner_insert ON membership_payment_reviews FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT auth.uid()));
CREATE POLICY membership_payment_owner_or_officer_select ON membership_payment_reviews FOR SELECT TO authenticated
  USING (member_id = (SELECT auth.uid()) OR is_officer() OR is_admin());

CREATE OR REPLACE FUNCTION member_privacy_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'hideGoogleIdentity',hide_google_identity,
    'hideRealName',hide_real_name,
    'deviceCacheEnabled',device_cache_enabled,
    'anonymousRanking',leaderboard_identity='anonymous',
    'automaticErrorReports',automatic_error_reports
  ) FROM member_profiles WHERE id=(SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION update_member_privacy_settings(requested jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF requested IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(requested) AS key
    WHERE key <> ALL (ARRAY['hideGoogleIdentity','hideRealName','deviceCacheEnabled','anonymousRanking','automaticErrorReports'])
  ) THEN
    RAISE EXCEPTION 'unsupported privacy setting';
  END IF;
  UPDATE member_profiles SET
    hide_google_identity=COALESCE((requested->>'hideGoogleIdentity')::boolean,true),
    hide_real_name=COALESCE((requested->>'hideRealName')::boolean,true),
    device_cache_enabled=COALESCE((requested->>'deviceCacheEnabled')::boolean,true),
    automatic_error_reports=COALESCE((requested->>'automaticErrorReports')::boolean,false),
    leaderboard_identity=CASE
      WHEN COALESCE((requested->>'anonymousRanking')::boolean,false) THEN 'anonymous'::leaderboard_identity_mode
      WHEN leaderboard_identity='anonymous' THEN 'nickname'::leaderboard_identity_mode
      ELSE leaderboard_identity END,
    real_name_leaderboard_consent=CASE WHEN COALESCE((requested->>'hideRealName')::boolean,true) THEN false ELSE real_name_leaderboard_consent END
  WHERE id=(SELECT auth.uid());
  SELECT member_privacy_settings() INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION current_membership_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'state',membership_status,
    'paid',membership_paid,
    'canEnterMemberPortal',membership_status='active' AND membership_paid,
    'paymentReference',COALESCE((SELECT payment_reference FROM membership_payment_reviews WHERE member_id=member_profiles.id ORDER BY submitted_at DESC LIMIT 1),''),
    'updatedAt',membership_updated_at,
    'demo',false
  ) FROM member_profiles WHERE id=(SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION review_membership(requested_member uuid, requested_approved boolean, requested_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer approval required'; END IF;
  UPDATE member_profiles SET membership_status=CASE WHEN requested_approved THEN 'active' ELSE 'rejected' END,
    membership_paid=requested_approved, membership_updated_at=now()
  WHERE id=requested_member;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found'; END IF;
  UPDATE membership_payment_reviews SET state=CASE WHEN requested_approved THEN 'approved' ELSE 'rejected' END,
    reviewed_at=now(), reviewed_by=(SELECT auth.uid()), review_note=left(COALESCE(requested_note,''),500)
  WHERE id=(SELECT id FROM membership_payment_reviews WHERE member_id=requested_member AND state='pending' ORDER BY submitted_at DESC LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION member_privacy_settings(), update_member_privacy_settings(jsonb), current_membership_status(), review_membership(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_privacy_settings(), update_member_privacy_settings(jsonb), current_membership_status(), review_membership(uuid,boolean,text) TO authenticated;

COMMENT ON TABLE product_feedback IS 'Privacy-safe structured UI diagnostics; raw HTML, screenshots, cookies, tokens, and form values are prohibited.';
COMMENT ON TABLE membership_funnel_events IS 'Server/service-role append-only conversion events. Browser clients receive no direct table grant.';
