-- Structured, photo-backed career evidence. Browser clients remain read-only;
-- validated server-gateway commands/service_role own all writes.

DO $$ BEGIN
  CREATE TYPE evidence_review_state AS ENUM ('draft', 'ai_proposed', 'source_matched', 'user_verified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE career_evidence_sources
  ADD COLUMN IF NOT EXISTS provider_key text,
  ADD COLUMN IF NOT EXISTS connection_state connection_state NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS maturity text NOT NULL DEFAULT 'available'
    CHECK (maturity IN ('available', 'beta', 'experimental')),
  ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'manual'
    CHECK (connection_method IN ('website_session', 'url', 'upload', 'manual')),
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS configured_url text CHECK (configured_url IS NULL OR configured_url ~ '^https?://'),
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(permissions) = 'array'),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_sources_provider
  ON career_evidence_sources(user_id, provider_key);

ALTER TABLE career_evidence_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quantitative_results jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(quantitative_results) = 'array'),
  ADD COLUMN IF NOT EXISTS qualitative_results jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(qualitative_results) = 'array'),
  ADD COLUMN IF NOT EXISTS skill_tags jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(skill_tags) = 'array'),
  ADD COLUMN IF NOT EXISTS review_state evidence_review_state NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS confidence integer CHECK (confidence BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS source_url text CHECK (source_url IS NULL OR source_url ~ '^https?://');

UPDATE career_evidence_items SET title = label WHERE title IS NULL;
ALTER TABLE career_evidence_items ALTER COLUMN title SET NOT NULL;

CREATE TABLE IF NOT EXISTS career_evidence_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES career_evidence_items(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'document')),
  exif_stripped boolean NOT NULL DEFAULT false,
  is_demo_fixture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storage_path)
);

CREATE TABLE IF NOT EXISTS career_evidence_ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES career_evidence_items(id) ON DELETE CASCADE,
  provider_label text NOT NULL,
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  source_media_ids uuid[] NOT NULL DEFAULT '{}',
  confidence integer CHECK (confidence BETWEEN 0 AND 100),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'rejected')),
  user_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_evidence_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES career_evidence_items(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('user', 'ai_proposal', 'system')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  proposal_id uuid REFERENCES career_evidence_ai_proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_media_item ON career_evidence_media(user_id, evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_evidence_proposals_item ON career_evidence_ai_proposals(user_id, evidence_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_revisions_item ON career_evidence_revisions(user_id, evidence_item_id, created_at DESC);

ALTER TABLE career_evidence_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_evidence_ai_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_evidence_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY career_evidence_media_owner_select ON career_evidence_media FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY career_evidence_ai_proposals_owner_select ON career_evidence_ai_proposals FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY career_evidence_revisions_owner_select ON career_evidence_revisions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('career-evidence-media', 'career-evidence-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY career_evidence_storage_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'career-evidence-media' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE OR REPLACE FUNCTION career_evidence_detail(requested_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT CASE WHEN requested_user_id IS DISTINCT FROM (SELECT auth.uid())
    THEN NULL
    ELSE jsonb_build_object(
      'sources', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', COALESCE(source.provider_key, source.id::text),
          'label', source.label, 'kind', source.source_kind,
          'status', source.verification_state, 'maturity', source.maturity,
          'connectionStatus', source.connection_state,
          'connectionMethod', source.connection_method,
          'description', source.description, 'permissions', source.permissions,
          'configuredUrl', source.configured_url,
          'evidenceCount', (SELECT count(*) FROM career_evidence_items count_item WHERE count_item.source_id = source.id),
          'lastSyncedAt', source.last_synced_at
        ) ORDER BY source.created_at)
        FROM career_evidence_sources source
        WHERE source.user_id = requested_user_id
      ), '[]'::jsonb),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', item.id, 'sourceId', COALESCE(source.provider_key, item.source_id::text), 'title', item.title,
          'organization', item.organization, 'role', item.role_label,
          'dateLabel', item.date_label, 'description', item.description,
          'quantitative', item.quantitative_results, 'qualitative', item.qualitative_results,
          'skills', item.skill_tags, 'verificationState', item.review_state,
          'confidence', item.confidence, 'sourceUrl', item.source_url,
          'mediaUrl', '', 'mediaPath', COALESCE(media.storage_path, ''),
          'mediaAlt', COALESCE(media.alt_text, ''),
          'aiProposal', proposal.proposal
        ) ORDER BY item.updated_at DESC)
        FROM career_evidence_items item
        LEFT JOIN career_evidence_sources source ON source.id = item.source_id AND source.user_id = requested_user_id
        LEFT JOIN LATERAL (
          SELECT alt_text, storage_path FROM career_evidence_media
          WHERE evidence_item_id = item.id AND user_id = requested_user_id
          ORDER BY created_at LIMIT 1
        ) media ON true
        LEFT JOIN LATERAL (
          SELECT proposal FROM career_evidence_ai_proposals
          WHERE evidence_item_id = item.id AND user_id = requested_user_id AND state = 'pending'
          ORDER BY created_at DESC LIMIT 1
        ) proposal ON true
        WHERE item.user_id = requested_user_id
      ), '[]'::jsonb)
    ) END;
$$;

REVOKE ALL ON FUNCTION career_evidence_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION career_evidence_detail(uuid) TO authenticated;
