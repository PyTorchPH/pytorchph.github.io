-- Manual-first workspaces keep trusted provenance distinct from automated collection.

ALTER TABLE career_evidence_items
  ADD COLUMN IF NOT EXISTS collection_origin text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (collection_origin IN ('manual', 'upload', 'automated_scrape', 'legacy_unknown'));

UPDATE career_evidence_items item
SET collection_origin = CASE
  WHEN source.provider_key = 'manual' THEN 'manual'
  WHEN source.provider_key = 'upload' THEN 'upload'
  WHEN source.connection_method = 'website_session' THEN 'automated_scrape'
  ELSE 'legacy_unknown'
END
FROM career_evidence_sources source
WHERE item.source_id = source.id AND item.collection_origin = 'legacy_unknown';

ALTER TABLE career_evidence_revisions
  ADD COLUMN IF NOT EXISTS mutation_origin text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (mutation_origin IN ('manual', 'ai_assisted', 'extension_scrape', 'legacy_unknown'));

COMMENT ON COLUMN career_evidence_items.collection_origin IS
  'Trusted collection provenance; browser payloads cannot choose this value.';
COMMENT ON COLUMN career_evidence_revisions.mutation_origin IS
  'Trusted mutation provenance for audit-log distinction between manual and automated changes.';

ALTER TABLE market_opportunities
  ADD COLUMN IF NOT EXISTS record_origin text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (record_origin IN ('manual', 'automated_scrape', 'legacy_unknown'));

CREATE TABLE IF NOT EXISTS market_opportunity_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES market_opportunities(id) ON DELETE CASCADE,
  mutation_origin text NOT NULL CHECK (mutation_origin IN ('manual', 'automated_scrape')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_opportunity_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY market_opportunity_revisions_owner_select ON market_opportunity_revisions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

COMMENT ON COLUMN market_opportunities.record_origin IS
  'Trusted source distinction for manually tracked versus scraper-discovered roles.';
