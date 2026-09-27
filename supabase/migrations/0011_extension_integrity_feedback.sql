-- MV3 evidence intake, officer adjudication, appeals, operational feedback, and provisional standings.
-- Member-controlled browsers are proposal sources only; official points remain server-authored.

ALTER TABLE evidence_claims DROP CONSTRAINT IF EXISTS evidence_claims_source_check;
ALTER TABLE evidence_claims DROP CONSTRAINT IF EXISTS evidence_claims_provenance_check;
ALTER TABLE evidence_claims
  ADD CONSTRAINT evidence_claims_source_check CHECK(source IN ('facebook','linkedin','github','manual')),
  ADD CONSTRAINT evidence_claims_provenance_check CHECK(provenance IN ('scraped_pending','scraped_verified','manual_pending','officer_reviewed','rejected','superseded','disputed')),
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual' CHECK(origin IN ('extension_scrape','manual')),
  ADD COLUMN IF NOT EXISTS proposed_level text CHECK(proposed_level IN ('participation','contributor','finalist_lead','winner_top_award')),
  ADD COLUMN IF NOT EXISTS normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(normalized_payload)='object'),
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(warnings)='array'),
  ADD COLUMN IF NOT EXISTS risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(risk_signals)='array'),
  ADD COLUMN IF NOT EXISTS layout_fingerprint text,
  ADD COLUMN IF NOT EXISTS provisional_points integer NOT NULL DEFAULT 0 CHECK(provisional_points>=0),
  ADD COLUMN IF NOT EXISTS decision_reason text;
UPDATE evidence_claims SET origin='extension_scrape' WHERE source<>'manual' AND origin='manual';

CREATE TABLE evidence_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK(schema_version=1), source text NOT NULL CHECK(source IN ('facebook','linkedin','github','manual')),
  origin text NOT NULL CHECK(origin IN ('extension_scrape','manual')), page_url text NOT NULL, collected_at timestamptz NOT NULL,
  adapter_version text NOT NULL, layout_fingerprint text, content_hash text NOT NULL,
  normalized_payload jsonb NOT NULL CHECK(jsonb_typeof(normalized_payload)='object'), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id,content_hash)
);
ALTER TABLE evidence_claims ADD COLUMN IF NOT EXISTS submission_id uuid REFERENCES evidence_submissions(id) ON DELETE SET NULL;
ALTER TABLE evidence_claim_reviews DROP CONSTRAINT IF EXISTS evidence_claim_reviews_claim_id_key;
ALTER TABLE evidence_claim_reviews DROP CONSTRAINT IF EXISTS evidence_claim_reviews_decision_check;
ALTER TABLE evidence_claim_reviews
  ADD CONSTRAINT evidence_claim_reviews_decision_check CHECK(decision IN ('approve','scraper_defect','reject_unsupported','confirm_falsification','confirm_tampering')),
  ADD COLUMN IF NOT EXISTS verified_level text CHECK(verified_level IN ('participation','contributor','finalist_lead','winner_top_award')),
  ADD COLUMN IF NOT EXISTS reason text CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 4 AND 1200);

CREATE TABLE point_rubric_versions (
  version integer PRIMARY KEY, label text NOT NULL, published_at timestamptz, published_by uuid REFERENCES member_profiles(id)
);
CREATE TABLE point_rubric_levels (
  rubric_version integer NOT NULL REFERENCES point_rubric_versions(version), level text NOT NULL,
  units integer NOT NULL CHECK(units BETWEEN 1 AND 100), PRIMARY KEY(rubric_version,level),
  CHECK(level IN ('participation','contributor','finalist_lead','winner_top_award'))
);
INSERT INTO point_rubric_versions(version,label,published_at) VALUES(1,'Evidence level matrix v1',now()) ON CONFLICT DO NOTHING;
INSERT INTO point_rubric_levels VALUES(1,'participation',1),(1,'contributor',2),(1,'finalist_lead',3),(1,'winner_top_award',4) ON CONFLICT DO NOTHING;

CREATE TABLE leaderboard_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES evidence_claims(id), violation_type text NOT NULL CHECK(violation_type IN ('manual_falsification','scraper_tampering')),
  safe_reason text NOT NULL CHECK(length(trim(safe_reason)) BETWEEN 4 AND 1200), internal_reason text NOT NULL DEFAULT '',
  imposed_by uuid NOT NULL REFERENCES member_profiles(id), imposed_at timestamptz NOT NULL DEFAULT now(), lifted_by uuid REFERENCES member_profiles(id), lifted_at timestamptz
);
CREATE UNIQUE INDEX one_active_leaderboard_sanction ON leaderboard_sanctions(member_id) WHERE lifted_at IS NULL;
CREATE TABLE evidence_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sanction_id uuid NOT NULL REFERENCES leaderboard_sanctions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE, note text NOT NULL CHECK(length(trim(note)) BETWEEN 10 AND 1200),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','restored','upheld')), decided_by uuid REFERENCES member_profiles(id),
  decision_reason text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE UNIQUE INDEX one_open_evidence_appeal ON evidence_appeals(sanction_id) WHERE state='open';

CREATE TABLE operational_events (
  event_id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  correlation_id uuid NOT NULL, component text NOT NULL, stage text NOT NULL, code text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('info','warning','error','critical')),
  outcome text NOT NULL CHECK(outcome IN ('succeeded','stopped','failed')), retryable boolean NOT NULL,
  route text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_events_triage ON operational_events(severity,occurred_at DESC);

ALTER TABLE evidence_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_rubric_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_rubric_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_sanctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON evidence_submissions,point_rubric_versions,point_rubric_levels,leaderboard_sanctions,evidence_appeals,operational_events FROM anon,authenticated;
GRANT SELECT ON evidence_submissions,point_rubric_versions,point_rubric_levels,operational_events TO authenticated;
CREATE POLICY evidence_submission_owner_officer ON evidence_submissions FOR SELECT TO authenticated USING(member_id=(SELECT auth.uid()) OR is_officer() OR is_admin());
CREATE POLICY rubric_authenticated_read ON point_rubric_versions FOR SELECT TO authenticated USING(published_at IS NOT NULL);
CREATE POLICY rubric_levels_authenticated_read ON point_rubric_levels FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM point_rubric_versions v WHERE v.version=rubric_version AND v.published_at IS NOT NULL));
CREATE POLICY sanction_owner_officer ON leaderboard_sanctions FOR SELECT TO authenticated USING(member_id=(SELECT auth.uid()) OR is_officer() OR is_admin());
CREATE POLICY appeal_owner_officer ON evidence_appeals FOR SELECT TO authenticated USING(member_id=(SELECT auth.uid()) OR is_officer() OR is_admin());
CREATE POLICY operational_officer_read ON operational_events FOR SELECT TO authenticated USING(is_officer() OR is_admin());

CREATE OR REPLACE FUNCTION evidence_rubric_points(requested_source text, requested_level text)
RETURNS TABLE(raw_points integer,weight numeric,weighted_points integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT l.units*10,
    CASE requested_source WHEN 'github' THEN 2.0::numeric WHEN 'facebook' THEN 3.0::numeric WHEN 'linkedin' THEN 3.0::numeric ELSE 3.0::numeric END,
    (l.units*10*CASE requested_source WHEN 'github' THEN 2.0 WHEN 'facebook' THEN 3.0 WHEN 'linkedin' THEN 3.0 ELSE 3.0 END)::integer
  FROM point_rubric_levels l JOIN point_rubric_versions v ON v.version=l.rubric_version
  WHERE l.level=requested_level AND v.published_at IS NOT NULL ORDER BY l.rubric_version DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION submit_evidence_envelope(requested jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE submission uuid; existing uuid; item jsonb; claim uuid; claim_ids jsonb:='[]'::jsonb; item_hash text; provisional integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF (requested->>'schemaVersion')::integer<>1 OR requested->>'source' NOT IN ('facebook','linkedin','github','manual')
    OR requested->>'origin' NOT IN ('extension_scrape','manual') OR requested->>'contentHash' !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(requested->'items')<>'array' OR jsonb_array_length(requested->'items') NOT BETWEEN 1 AND 50
    OR (requested->>'collectedAt')::timestamptz < now()-interval '7 days' OR (requested->>'collectedAt')::timestamptz > now()+interval '5 minutes'
  THEN RAISE EXCEPTION 'invalid evidence envelope'; END IF;
  SELECT id INTO existing FROM evidence_submissions WHERE member_id=(SELECT auth.uid()) AND content_hash=requested->>'contentHash';
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('submissionId',existing,'claimIds','[]'::jsonb,'duplicate',true); END IF;
  INSERT INTO evidence_submissions(member_id,schema_version,source,origin,page_url,collected_at,adapter_version,layout_fingerprint,content_hash,normalized_payload)
    VALUES((SELECT auth.uid()),1,requested->>'source',requested->>'origin',requested->>'pageUrl',(requested->>'collectedAt')::timestamptz,requested->>'adapterVersion',requested->>'layoutFingerprint',requested->>'contentHash',requested)
    RETURNING id INTO submission;
  FOR item IN SELECT * FROM jsonb_array_elements(requested->'items') LOOP
    IF length(trim(item->>'title')) NOT BETWEEN 3 AND 240 OR item->>'sourceUrl' !~ '^https://' OR item->>'proposedLevel' NOT IN ('participation','contributor','finalist_lead','winner_top_award') THEN RAISE EXCEPTION 'invalid evidence item'; END IF;
    SELECT weighted_points INTO provisional FROM evidence_rubric_points(requested->>'source',item->>'proposedLevel');
    item_hash:='sha256:'||encode(digest((requested->>'contentHash')||':'||(item->>'sourceUrl')||':'||(item->>'title'),'sha256'),'hex');
    INSERT INTO evidence_claims(member_id,title,source,provenance,department,source_url,content_hash,scraper_version,requested_points,approved_points,origin,proposed_level,normalized_payload,warnings,layout_fingerprint,provisional_points,submission_id)
      VALUES((SELECT auth.uid()),left(trim(item->>'title'),240),requested->>'source',CASE WHEN requested->>'origin'='manual' THEN 'manual_pending' ELSE 'scraped_pending' END,(item->>'department')::department,item->>'sourceUrl',item_hash,requested->>'adapterVersion',0,0,requested->>'origin',item->>'proposedLevel',item,COALESCE(requested->'warnings','[]'::jsonb),requested->>'layoutFingerprint',COALESCE(provisional,0),submission)
      RETURNING id INTO claim;
    claim_ids:=claim_ids||to_jsonb(claim);
  END LOOP;
  RETURN jsonb_build_object('submissionId',submission,'claimIds',claim_ids,'duplicate',false);
END; $$;

-- Compatibility boundary for the pre-extension scraper. It may propose a pending claim, but it can
-- no longer verify evidence or append points without the same officer adjudication used above.
CREATE OR REPLACE FUNCTION accept_scraped_evidence(requested jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claim_id uuid; source_value text; url_value text; member_value uuid; scraped_value timestamptz; provisional integer;
BEGIN
  source_value:=requested->>'source'; url_value:=requested->>'sourceUrl'; member_value:=(requested->>'memberId')::uuid;
  scraped_value:=(requested->>'scrapedAt')::timestamptz;
  IF source_value NOT IN ('facebook','linkedin') OR requested->>'contentHash' !~ '^sha256:[0-9a-f]{64}$'
    OR requested->>'scraperVersion' !~ '^[A-Za-z0-9._-]{3,80}$'
    OR scraped_value < now()-interval '7 days' OR scraped_value > now()+interval '5 minutes'
    OR length(trim(requested->>'title')) NOT BETWEEN 3 AND 240
    OR (source_value='facebook' AND url_value !~ '^https://([^/]+\.)?facebook\.com/')
    OR (source_value='linkedin' AND url_value !~ '^https://([^/]+\.)?linkedin\.com/')
    OR NOT EXISTS (SELECT 1 FROM career_evidence_sources source WHERE source.user_id=member_value AND source.provider_key=source_value AND source.connection_state='connected')
  THEN RAISE EXCEPTION 'scraper provenance checks failed'; END IF;
  SELECT weighted_points INTO provisional FROM evidence_rubric_points(source_value,'participation');
  INSERT INTO evidence_claims(member_id,title,source,provenance,department,source_url,content_hash,scraper_version,requested_points,approved_points,origin,proposed_level,normalized_payload,provisional_points)
    VALUES(member_value,left(trim(requested->>'title'),240),source_value,'scraped_pending',(requested->>'department')::department,url_value,requested->>'contentHash',requested->>'scraperVersion',0,0,'extension_scrape','participation',requested-ARRAY['points','memberId'],COALESCE(provisional,0))
    RETURNING id INTO claim_id;
  RETURN claim_id;
END; $$;

CREATE OR REPLACE FUNCTION ingest_operational_event(requested jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF requested->>'eventId' IS NULL OR requested->>'outcome' NOT IN ('succeeded','stopped','failed') OR requested->>'severity' NOT IN ('info','warning','error','critical') THEN RAISE EXCEPTION 'invalid operational event'; END IF;
  INSERT INTO operational_events(event_id,reporter_id,correlation_id,component,stage,code,severity,outcome,retryable,route,payload,occurred_at)
    VALUES((requested->>'eventId')::uuid,(SELECT auth.uid()),(requested->>'correlationId')::uuid,left(requested->>'component',100),left(requested->>'stage',100),left(requested->>'code',120),requested->>'severity',requested->>'outcome',(requested->>'retryable')::boolean,left(requested->>'route',240),requested,(requested->>'occurredAt')::timestamptz)
    ON CONFLICT(event_id) DO NOTHING;
  DELETE FROM operational_events WHERE occurred_at<now()-interval '30 days';
END; $$;

CREATE OR REPLACE FUNCTION review_evidence_claim(requested_claim uuid, requested_decision text, requested_level text DEFAULT NULL, requested_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claim evidence_claims%ROWTYPE; reviewer_dept department; rubric record; next_provenance text; violation text;
BEGIN
  SELECT * INTO claim FROM evidence_claims WHERE id=requested_claim FOR UPDATE;
  IF NOT FOUND OR claim.provenance NOT IN ('manual_pending','scraped_pending','disputed') THEN RAISE EXCEPTION 'pending claim not found'; END IF;
  SELECT officer_department INTO reviewer_dept FROM member_profiles WHERE id=(SELECT auth.uid()) AND (is_officer OR role IN ('admin','super_admin'));
  IF reviewer_dept IS DISTINCT FROM claim.department AND NOT is_admin() THEN RAISE EXCEPTION 'responsible department approval required'; END IF;
  IF requested_decision NOT IN ('approve','scraper_defect','reject_unsupported','confirm_falsification','confirm_tampering') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF requested_decision='scraper_defect' AND claim.origin<>'extension_scrape' THEN RAISE EXCEPTION 'scraper defect requires extension evidence'; END IF;
  IF requested_decision='confirm_falsification' AND claim.origin<>'manual' THEN RAISE EXCEPTION 'falsification decision requires manual evidence'; END IF;
  IF requested_decision='confirm_tampering' AND claim.origin<>'extension_scrape' THEN RAISE EXCEPTION 'tampering decision requires extension evidence'; END IF;
  IF requested_decision='approve' THEN
    SELECT * INTO rubric FROM evidence_rubric_points(claim.source,requested_level);
    IF rubric.raw_points IS NULL THEN RAISE EXCEPTION 'published rubric level required'; END IF;
    next_provenance:='officer_reviewed';
    INSERT INTO point_events(member_id,source,points,weight,description,reference_id,reference_table)
      VALUES(claim.member_id,CASE WHEN claim.source='github' THEN 'project'::point_source ELSE 'achievement'::point_source END,rubric.raw_points,rubric.weight,claim.title,claim.id,'evidence_claims');
  ELSE
    IF length(trim(requested_reason))<4 THEN RAISE EXCEPTION 'review reason required'; END IF;
    next_provenance:=CASE WHEN requested_decision='scraper_defect' THEN 'disputed' ELSE 'rejected' END;
    IF requested_decision IN ('confirm_falsification','confirm_tampering') THEN
      violation:=CASE WHEN requested_decision='confirm_tampering' THEN 'scraper_tampering' ELSE 'manual_falsification' END;
      INSERT INTO leaderboard_sanctions(member_id,claim_id,violation_type,safe_reason,internal_reason,imposed_by)
        VALUES(claim.member_id,claim.id,violation,left(requested_reason,1200),requested_decision,(SELECT auth.uid()))
        ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  INSERT INTO evidence_claim_reviews(claim_id,reviewer_id,department,decision,claim_hash,verified_level,reason)
    VALUES(claim.id,(SELECT auth.uid()),claim.department,requested_decision,claim.content_hash,requested_level,NULLIF(left(requested_reason,1200),''));
  UPDATE evidence_claims SET provenance=next_provenance,proposed_level=COALESCE(requested_level,proposed_level),approved_points=CASE WHEN requested_decision='approve' THEN rubric.weighted_points ELSE 0 END,decision_reason=NULLIF(left(requested_reason,1200),''),updated_at=now() WHERE id=claim.id;
  RETURN jsonb_build_object('id',claim.id,'memberLabel','Member '||upper(left(claim.member_id::text,8)),'title',claim.title,'source',claim.source,'provenance',next_provenance,'department',claim.department,'sourceUrl',claim.source_url,'contentHash',claim.content_hash,'points',CASE WHEN requested_decision='approve' THEN rubric.weighted_points ELSE 0 END,'origin',claim.origin,'proposedLevel',COALESCE(requested_level,claim.proposed_level),'normalizedPayload',claim.normalized_payload,'warnings',claim.warnings,'riskSignals',claim.risk_signals,'decisionReason',NULLIF(left(requested_reason,1200),''),'updatedAt',now());
END; $$;

CREATE OR REPLACE FUNCTION member_evidence_integrity() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sanctionId',s.id,'claimId',s.claim_id,'reason',s.safe_reason,'imposedAt',s.imposed_at,
    'appeal',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'state',a.state,'note',a.note,'decisionReason',a.decision_reason,'createdAt',a.created_at,'decidedAt',a.decided_at) END
  ) ORDER BY s.imposed_at DESC),'[]'::jsonb)
  FROM leaderboard_sanctions s LEFT JOIN LATERAL (SELECT * FROM evidence_appeals WHERE sanction_id=s.id ORDER BY created_at DESC LIMIT 1) a ON true
  WHERE s.member_id=(SELECT auth.uid()) AND s.lifted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION officer_evidence_appeals() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN is_officer() OR is_admin() THEN COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'state',a.state,'note',a.note,'decisionReason',a.decision_reason,'createdAt',a.created_at,'decidedAt',a.decided_at,
    'sanctionId',s.id,'claimId',s.claim_id,'memberLabel','Member '||upper(left(s.member_id::text,8)),'violationType',s.violation_type
  ) ORDER BY a.created_at),'[]'::jsonb) ELSE '[]'::jsonb END
  FROM evidence_appeals a JOIN leaderboard_sanctions s ON s.id=a.sanction_id WHERE a.state='open';
$$;

CREATE OR REPLACE FUNCTION member_leaderboard(
  requested_season text,
  requested_skill text,
  requested_page integer,
  requested_page_size integer,
  requested_view text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE selected leaderboard_seasons%ROWTYPE; base jsonb; result jsonb;
BEGIN
  IF requested_view NOT IN ('both','verified','pending') THEN RAISE EXCEPTION 'invalid leaderboard view'; END IF;
  IF requested_page < 1 OR requested_page_size < 1 OR requested_page_size > 100 THEN RAISE EXCEPTION 'invalid pagination'; END IF;
  SELECT * INTO selected FROM leaderboard_seasons
    WHERE slug=COALESCE(requested_season,(SELECT slug FROM leaderboard_seasons WHERE state='active' ORDER BY starts_at DESC LIMIT 1))
      AND state IN ('active','completed');
  IF selected.id IS NULL THEN RAISE EXCEPTION 'season not found'; END IF;
  IF selected.state='completed' THEN
    base:=member_leaderboard(requested_season,requested_skill,requested_page,requested_page_size);
    IF requested_view='pending' THEN RETURN jsonb_set(jsonb_set(base||jsonb_build_object('view',requested_view),'{entries}','[]'::jsonb),'{total}','0'::jsonb); END IF;
    RETURN jsonb_set(base||jsonb_build_object('view',requested_view),'{entries}',COALESCE((SELECT jsonb_agg(entry||jsonb_build_object('verifiedPoints',entry->'points','pendingPoints',0)) FROM jsonb_array_elements(base->'entries') entry),'[]'::jsonb));
  END IF;

  WITH verified AS (
    SELECT pe.member_id,SUM(pe.weighted_points)::numeric(12,2) points,
      COUNT(DISTINCT date_trunc('week',pe.earned_at AT TIME ZONE 'Asia/Manila'))::integer streak
    FROM point_events pe WHERE pe.earned_at>=selected.starts_at AND pe.earned_at<selected.ends_at
      AND (requested_skill IS NULL OR EXISTS(SELECT 1 FROM point_event_skills pes JOIN skills s ON s.id=pes.skill_id WHERE pes.point_event_id=pe.id AND s.status='approved' AND s.slug=requested_skill))
    GROUP BY pe.member_id
  ), pending AS (
    SELECT member_id,SUM(provisional_points)::numeric(12,2) points FROM evidence_claims
    WHERE requested_skill IS NULL AND provenance IN ('manual_pending','scraped_pending','disputed') AND provisional_points>0
      AND created_at>=selected.starts_at AND created_at<selected.ends_at GROUP BY member_id
  ), members AS (
    SELECT member_id FROM verified UNION SELECT member_id FROM pending
  ), scored AS (
    SELECT m.member_id,COALESCE(v.points,0) verified_points,COALESCE(p.points,0) pending_points,COALESCE(v.streak,0) streak,
      CASE requested_view WHEN 'verified' THEN COALESCE(v.points,0) WHEN 'pending' THEN COALESCE(p.points,0) ELSE COALESCE(v.points,0)+COALESCE(p.points,0) END points
    FROM members m LEFT JOIN verified v USING(member_id) LEFT JOIN pending p USING(member_id)
    WHERE NOT EXISTS(SELECT 1 FROM leaderboard_sanctions sanction WHERE sanction.member_id=m.member_id AND sanction.lifted_at IS NULL)
  ), visible AS (
    SELECT s.*,dense_rank() OVER(ORDER BY s.points DESC)::integer rank,
      row_number() OVER(ORDER BY s.points DESC,lower(mp.leaderboard_username),s.member_id)::integer stable_order,
      CASE WHEN mp.leaderboard_identity='anonymous' THEN COALESCE(aa.alias,'Member #'||upper(left(mp.id::text,5)))
        WHEN mp.leaderboard_identity='real_name' AND mp.real_name_leaderboard_consent THEN mp.display_name ELSE mp.leaderboard_username END display_label,
      threshold.tier,threshold.division,
      COALESCE((SELECT jsonb_agg(name ORDER BY skill_points DESC,name) FROM (
        SELECT skill.display_name name,SUM(event.weighted_points) skill_points FROM point_events event
        JOIN point_event_skills tagged ON tagged.point_event_id=event.id JOIN skills skill ON skill.id=tagged.skill_id AND skill.status='approved'
        WHERE event.member_id=s.member_id AND event.earned_at>=selected.starts_at AND event.earned_at<selected.ends_at
        GROUP BY skill.id,skill.display_name ORDER BY skill_points DESC,skill.display_name LIMIT 5
      ) top_skills),'[]'::jsonb) verified_skills
    FROM scored s JOIN member_profiles mp ON mp.id=s.member_id
    LEFT JOIN leaderboard_anonymous_aliases aa ON aa.season_id=selected.id AND aa.member_id=s.member_id
    LEFT JOIN LATERAL (SELECT tier,division FROM leaderboard_rank_thresholds WHERE policy_version=selected.rank_policy_version AND minimum_points<=s.points ORDER BY minimum_points DESC LIMIT 1) threshold ON true
    WHERE s.points>0
  ), paged AS (
    SELECT * FROM visible ORDER BY stable_order OFFSET (requested_page-1)*requested_page_size LIMIT requested_page_size
  ) SELECT jsonb_build_object(
    'season',jsonb_build_object('slug',selected.slug,'label',selected.label,'state',selected.state,'startsAt',selected.starts_at,'endsAt',selected.ends_at),
    'view',requested_view,
    'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('rank',rank,'displayLabel',display_label,'points',points,'verifiedPoints',verified_points,'pendingPoints',pending_points,'streak',streak,'tier',tier,'division',division,'verifiedSkills',verified_skills,'isCurrentUser',member_id=(SELECT auth.uid())) ORDER BY stable_order) FROM paged),'[]'::jsonb),
    'page',requested_page,'pageSize',requested_page_size,'total',(SELECT count(*) FROM visible),
    'skills',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',display_name) ORDER BY display_name) FROM skills WHERE status='approved'),'[]'::jsonb),
    'seasons',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'label',label,'state',state) ORDER BY starts_at DESC) FROM leaderboard_seasons WHERE state IN ('active','completed')),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION open_evidence_appeal(requested_sanction uuid,requested_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE appeal uuid;
BEGIN
  IF length(trim(requested_note)) NOT BETWEEN 10 AND 1200 OR NOT EXISTS(SELECT 1 FROM leaderboard_sanctions WHERE id=requested_sanction AND member_id=(SELECT auth.uid()) AND lifted_at IS NULL) THEN RAISE EXCEPTION 'active sanction and appeal note required'; END IF;
  INSERT INTO evidence_appeals(sanction_id,member_id,note) VALUES(requested_sanction,(SELECT auth.uid()),trim(requested_note)) RETURNING id INTO appeal; RETURN appeal;
END; $$;
CREATE OR REPLACE FUNCTION resolve_evidence_appeal(requested_appeal uuid,requested_decision text,requested_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE appeal evidence_appeals%ROWTYPE;
BEGIN
  IF NOT (is_officer() OR is_admin()) OR requested_decision NOT IN ('restore','uphold') OR length(trim(requested_reason))<4 THEN RAISE EXCEPTION 'officer decision and reason required'; END IF;
  SELECT * INTO appeal FROM evidence_appeals WHERE id=requested_appeal AND state='open' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'open appeal not found'; END IF;
  UPDATE evidence_appeals SET state=CASE WHEN requested_decision='restore' THEN 'restored' ELSE 'upheld' END,decided_by=(SELECT auth.uid()),decision_reason=left(requested_reason,1200),decided_at=now() WHERE id=appeal.id;
  IF requested_decision='restore' THEN UPDATE leaderboard_sanctions SET lifted_by=(SELECT auth.uid()),lifted_at=now() WHERE id=appeal.sanction_id; END IF;
END; $$;

REVOKE ALL ON FUNCTION evidence_rubric_points(text,text),submit_evidence_envelope(jsonb),ingest_operational_event(jsonb),review_evidence_claim(uuid,text,text,text),open_evidence_appeal(uuid,text),resolve_evidence_appeal(uuid,text,text),member_evidence_integrity(),officer_evidence_appeals(),member_leaderboard(text,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evidence_rubric_points(text,text),submit_evidence_envelope(jsonb),ingest_operational_event(jsonb),open_evidence_appeal(uuid,text),member_evidence_integrity() TO authenticated;
GRANT EXECUTE ON FUNCTION review_evidence_claim(uuid,text,text,text),resolve_evidence_appeal(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION officer_evidence_appeals() TO authenticated;
GRANT EXECUTE ON FUNCTION member_leaderboard(text,text,integer,integer,text) TO authenticated;

COMMENT ON TABLE operational_events IS '30-day privacy-safe lifecycle diagnostics; raw DOM, scraped text, credentials, cookies, tokens, screenshots, and full stacks are prohibited.';
COMMENT ON TABLE leaderboard_sanctions IS 'Officer-only leaderboard eligibility decisions; anomaly signals alone never create sanctions.';
