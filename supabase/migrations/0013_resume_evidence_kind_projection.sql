-- Preserve the normalized evidence kind across the product-detail boundary so resume injection
-- never infers professional experience from a project position label.
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
          'id', item.id, 'sourceId', COALESCE(source.provider_key, item.source_id::text),
          'evidenceKind', item.evidence_kind, 'title', item.title,
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
    )
  END;
$$;

REVOKE ALL ON FUNCTION career_evidence_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION career_evidence_detail(uuid) TO authenticated;
