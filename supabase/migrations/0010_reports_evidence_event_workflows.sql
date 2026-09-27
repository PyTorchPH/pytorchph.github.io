-- Officer feedback triage, provenance-gated evidence, and external event/SADO workflow.

ALTER TABLE product_feedback DROP CONSTRAINT IF EXISTS product_feedback_status_check;
ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES member_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT product_feedback_status_check CHECK (status IN ('received','triaged','in_progress','resolved','dismissed')),
  ADD CONSTRAINT product_feedback_severity_check CHECK (severity IN ('low','medium','high','critical'));

GRANT UPDATE ON product_feedback TO authenticated;
CREATE POLICY product_feedback_officer_update ON product_feedback FOR UPDATE TO authenticated
  USING (is_officer() OR is_admin()) WITH CHECK (is_officer() OR is_admin());

CREATE TABLE IF NOT EXISTS feedback_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL REFERENCES product_feedback(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES member_profiles(id) ON DELETE SET NULL, previous_status text, next_status text NOT NULL,
  severity text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE feedback_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feedback_audit_events FROM anon, authenticated;
GRANT SELECT ON feedback_audit_events TO authenticated;
CREATE POLICY feedback_audit_officer_select ON feedback_audit_events FOR SELECT TO authenticated USING (is_officer() OR is_admin());
CREATE OR REPLACE FUNCTION audit_feedback_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.severity IS DISTINCT FROM NEW.severity OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    INSERT INTO feedback_audit_events(feedback_id,actor_id,previous_status,next_status,severity) VALUES(NEW.id,(SELECT auth.uid()),OLD.status,NEW.status,NEW.severity);
  END IF;
  NEW.updated_at=now(); RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_feedback_audit ON product_feedback;
CREATE TRIGGER trg_feedback_audit BEFORE UPDATE ON product_feedback FOR EACH ROW EXECUTE FUNCTION audit_feedback_update();

CREATE TABLE IF NOT EXISTS feedback_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL REFERENCES product_feedback(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES member_profiles(id), body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE feedback_internal_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feedback_internal_notes FROM anon,authenticated;
GRANT SELECT,INSERT ON feedback_internal_notes TO authenticated;
CREATE POLICY feedback_internal_notes_officer_select ON feedback_internal_notes FOR SELECT TO authenticated USING(is_officer() OR is_admin());
CREATE POLICY feedback_internal_notes_officer_insert ON feedback_internal_notes FOR INSERT TO authenticated
  WITH CHECK((is_officer() OR is_admin()) AND author_id=(SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 240), source text NOT NULL CHECK(source IN ('facebook','linkedin','manual')),
  provenance text NOT NULL CHECK(provenance IN ('scraped_pending','scraped_verified','manual_pending','officer_reviewed','rejected','superseded')),
  department department NOT NULL, source_url text, content_hash text NOT NULL, scraper_version text,
  requested_points integer NOT NULL DEFAULT 0 CHECK(requested_points>=0), approved_points integer NOT NULL DEFAULT 0 CHECK(approved_points>=0),
  parent_claim_id uuid REFERENCES evidence_claims(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id,content_hash)
);
CREATE TABLE IF NOT EXISTS evidence_claim_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES member_profiles(id), department department NOT NULL, decision text NOT NULL CHECK(decision IN ('approve','reject')),
  claim_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(claim_id)
);
ALTER TABLE evidence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_claim_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON evidence_claims,evidence_claim_reviews FROM anon,authenticated;
GRANT SELECT ON evidence_claims,evidence_claim_reviews TO authenticated;
CREATE POLICY evidence_claim_owner_or_officer_select ON evidence_claims FOR SELECT TO authenticated USING(member_id=(SELECT auth.uid()) OR is_officer() OR is_admin());
CREATE POLICY evidence_review_officer_select ON evidence_claim_reviews FOR SELECT TO authenticated USING(is_officer() OR is_admin());

CREATE OR REPLACE FUNCTION review_evidence_claim(requested_claim uuid, requested_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claim evidence_claims%ROWTYPE; reviewer_dept department;
BEGIN
  SELECT * INTO claim FROM evidence_claims WHERE id=requested_claim FOR UPDATE;
  IF NOT FOUND OR claim.provenance<>'manual_pending' THEN RAISE EXCEPTION 'pending manual claim not found'; END IF;
  SELECT officer_department INTO reviewer_dept FROM member_profiles WHERE id=(SELECT auth.uid()) AND (is_officer OR role IN ('admin','super_admin'));
  IF reviewer_dept IS DISTINCT FROM claim.department THEN RAISE EXCEPTION 'responsible department approval required'; END IF;
  IF requested_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  INSERT INTO evidence_claim_reviews(claim_id,reviewer_id,department,decision,claim_hash) VALUES(claim.id,(SELECT auth.uid()),claim.department,requested_decision,claim.content_hash);
  UPDATE evidence_claims SET provenance=CASE WHEN requested_decision='approve' THEN 'officer_reviewed' ELSE 'rejected' END,
    approved_points=CASE WHEN requested_decision='approve' THEN requested_points ELSE 0 END,updated_at=now() WHERE id=claim.id;
  IF requested_decision='approve' AND claim.requested_points>0 THEN
    INSERT INTO point_events(member_id,source,points,weight,description,reference_id,reference_table)
      VALUES(claim.member_id,'achievement',claim.requested_points,1.0,claim.title,claim.id,'evidence_claims');
  END IF;
  RETURN jsonb_build_object('id',claim.id,'memberLabel','Member '||upper(left(claim.member_id::text,8)),'title',claim.title,'source',claim.source,
    'provenance',CASE WHEN requested_decision='approve' THEN 'officer_reviewed' ELSE 'rejected' END,'department',claim.department,
    'sourceUrl',claim.source_url,'contentHash',claim.content_hash,'points',CASE WHEN requested_decision='approve' THEN claim.requested_points ELSE 0 END,'updatedAt',now());
END; $$;

CREATE TABLE IF NOT EXISTS external_event_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submitted_by uuid NOT NULL REFERENCES member_profiles(id), payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'not_sado_approved' CHECK(status IN ('not_sado_approved','department_review','email_review','submitted_to_sado','sado_approved','rejected')),
  content_hash text NOT NULL, revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(submitted_by,content_hash)
);
CREATE TABLE IF NOT EXISTS external_event_interests (event_id uuid REFERENCES external_event_packages(id) ON DELETE CASCADE, member_id uuid REFERENCES member_profiles(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,member_id));
CREATE TABLE IF NOT EXISTS external_event_required_departments (event_id uuid REFERENCES external_event_packages(id) ON DELETE CASCADE, department department NOT NULL, PRIMARY KEY(event_id,department));
CREATE TABLE IF NOT EXISTS external_event_approvals (event_id uuid REFERENCES external_event_packages(id) ON DELETE CASCADE, department department NOT NULL, approver_id uuid REFERENCES member_profiles(id), revision integer NOT NULL, decision text NOT NULL DEFAULT 'approve', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,department,revision));
CREATE TABLE IF NOT EXISTS external_event_mail (
  event_id uuid PRIMARY KEY REFERENCES external_event_packages(id) ON DELETE CASCADE, subject text NOT NULL, body text NOT NULL, revision_hash text NOT NULL,
  approved_by uuid REFERENCES member_profiles(id), approved_at timestamptz, delivery_mode text NOT NULL DEFAULT 'copy_export'
    CHECK(delivery_mode IN ('copy_export','gmail')), delivery_status text NOT NULL DEFAULT 'pending'
    CHECK(delivery_status IN ('pending','sending','exported','sent','failed')), idempotency_key text UNIQUE,
  provider text, provider_message_id text, sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS external_event_sado_proofs (event_id uuid PRIMARY KEY REFERENCES external_event_packages(id) ON DELETE CASCADE, recorded_by uuid NOT NULL REFERENCES member_profiles(id), reference text NOT NULL, proof_storage_path text, recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE external_event_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_event_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_event_required_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_event_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_event_mail ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_event_sado_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_event_packages,external_event_interests,external_event_required_departments,external_event_approvals,external_event_mail,external_event_sado_proofs FROM anon,authenticated;
GRANT SELECT ON external_event_packages,external_event_interests TO authenticated;
GRANT SELECT ON external_event_required_departments,external_event_approvals,external_event_mail,external_event_sado_proofs TO authenticated;
CREATE POLICY external_events_authenticated_select ON external_event_packages FOR SELECT TO authenticated USING(true);
CREATE POLICY external_interest_authenticated_select ON external_event_interests FOR SELECT TO authenticated USING(true);
CREATE POLICY external_required_departments_authenticated_select ON external_event_required_departments FOR SELECT TO authenticated USING(true);
CREATE POLICY external_approval_officer_select ON external_event_approvals FOR SELECT TO authenticated USING(is_officer() OR is_admin());
CREATE POLICY external_mail_officer_select ON external_event_mail FOR SELECT TO authenticated USING(is_officer() OR is_admin());
CREATE POLICY external_sado_proof_officer_select ON external_event_sado_proofs FOR SELECT TO authenticated USING(is_officer() OR is_admin());

CREATE OR REPLACE FUNCTION submit_external_event(requested jsonb, requested_departments department[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_id uuid; expected_departments department[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  expected_departments:=CASE requested->>'category'
    WHEN 'events' THEN ARRAY['secretariat','treasurer','external_relations','executive']::department[]
    WHEN 'workshops' THEN ARRAY['secretariat','external_relations']::department[]
    WHEN 'hackathons' THEN ARRAY['secretariat','treasurer','external_relations']::department[]
    WHEN 'competitive-programming' THEN ARRAY['secretariat','treasurer','academics']::department[]
    ELSE NULL END;
  IF requested->>'scope'<>'external' OR requested->>'sourceUrl' !~ '^https?://' OR requested->>'contentHash' !~ '^sha256:[0-9a-f]{64}$'
    OR expected_departments IS NULL OR requested_departments IS DISTINCT FROM expected_departments THEN RAISE EXCEPTION 'invalid external event package or routing'; END IF;
  INSERT INTO external_event_packages(submitted_by,payload,content_hash) VALUES((SELECT auth.uid()),requested,requested->>'contentHash') RETURNING id INTO event_id;
  INSERT INTO external_event_required_departments(event_id,department) SELECT event_id,unnest(expected_departments);
  RETURN jsonb_build_object('payload',requested,'id',event_id,'submittedBy',(SELECT auth.uid()),'status','not_sado_approved','interested',false,'interestCount',0,
    'revision',1,'requiredDepartments',to_jsonb(expected_departments),'approvedDepartments','[]'::jsonb,'emailDraft',NULL,'sadoReference',NULL,'createdAt',now());
END; $$;

CREATE OR REPLACE FUNCTION external_event_feed() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('payload',e.payload,'id',e.id,'submittedBy',e.submitted_by,'submitterLabel',CASE WHEN e.submitted_by=(SELECT auth.uid()) THEN 'You' ELSE 'Member '||upper(left(e.submitted_by::text,8)) END,
    'status',e.status,'interested',EXISTS(SELECT 1 FROM external_event_interests i WHERE i.event_id=e.id AND i.member_id=(SELECT auth.uid())),
    'interestCount',(SELECT count(*) FROM external_event_interests i WHERE i.event_id=e.id),'revision',e.revision,
    'requiredDepartments',(SELECT COALESCE(jsonb_agg(r.department ORDER BY r.department),'[]'::jsonb) FROM external_event_required_departments r WHERE r.event_id=e.id),
    'approvedDepartments',(SELECT COALESCE(jsonb_agg(a.department ORDER BY a.department),'[]'::jsonb) FROM external_event_approvals a WHERE a.event_id=e.id AND a.revision=e.revision),
    'emailDraft',CASE WHEN is_officer() OR is_admin() THEN (SELECT jsonb_build_object('subject',m.subject,'body',m.body,'revisionHash',m.revision_hash,'deliveryMode',m.delivery_mode,'deliveryStatus',m.delivery_status) FROM external_event_mail m WHERE m.event_id=e.id) ELSE NULL END,
    'sadoReference',CASE WHEN is_officer() OR is_admin() THEN (SELECT p.reference FROM external_event_sado_proofs p WHERE p.event_id=e.id) ELSE NULL END,
    'createdAt',e.created_at) ORDER BY e.created_at DESC),'[]'::jsonb) FROM external_event_packages e;
$$;

CREATE OR REPLACE FUNCTION accept_scraped_evidence(requested jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claim_id uuid; source_value text; url_value text; member_value uuid; scraped_value timestamptz; points_value integer;
BEGIN
  source_value:=requested->>'source'; url_value:=requested->>'sourceUrl'; member_value:=(requested->>'memberId')::uuid;
  scraped_value:=(requested->>'scrapedAt')::timestamptz; points_value:=(requested->>'points')::integer;
  IF source_value NOT IN ('facebook','linkedin') OR requested->>'contentHash' !~ '^sha256:[0-9a-f]{64}$'
    OR requested->>'scraperVersion' !~ '^[A-Za-z0-9._-]{3,80}$'
    OR scraped_value < now()-interval '7 days' OR scraped_value > now()+interval '5 minutes'
    OR points_value < 0 OR points_value > 1000 OR length(trim(requested->>'title')) NOT BETWEEN 3 AND 240
    OR (source_value='facebook' AND url_value !~ '^https://([^/]+\.)?facebook\.com/')
    OR (source_value='linkedin' AND url_value !~ '^https://([^/]+\.)?linkedin\.com/')
    OR NOT EXISTS (SELECT 1 FROM career_evidence_sources source WHERE source.user_id=member_value
      AND source.provider_key=source_value AND source.connection_state='connected')
    THEN RAISE EXCEPTION 'scraper provenance checks failed'; END IF;
  INSERT INTO evidence_claims(member_id,title,source,provenance,department,source_url,content_hash,scraper_version,requested_points,approved_points)
    VALUES(member_value,left(trim(requested->>'title'),240),source_value,'scraped_verified',(requested->>'department')::department,url_value,requested->>'contentHash',requested->>'scraperVersion',points_value,points_value)
    RETURNING id INTO claim_id;
  INSERT INTO point_events(member_id,source,points,weight,description,reference_id,reference_table)
    VALUES(member_value,'achievement',points_value,1.0,left(trim(requested->>'title'),240),claim_id,'evidence_claims');
  RETURN claim_id;
END; $$;

CREATE OR REPLACE FUNCTION transition_external_event(requested_event uuid, requested_action text, requested_detail text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_row external_event_packages%ROWTYPE; dept department; approval_count integer; subject_value text; body_value text; hash_value text;
BEGIN
  SELECT * INTO event_row FROM external_event_packages WHERE id=requested_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  IF requested_action='interest' THEN
    INSERT INTO external_event_interests(event_id,member_id) VALUES(requested_event,(SELECT auth.uid())) ON CONFLICT DO NOTHING;
  ELSE
    IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer authorization required'; END IF;
    IF requested_action='approve_department' THEN
      SELECT officer_department INTO dept FROM member_profiles WHERE id=(SELECT auth.uid());
      IF dept IS NULL OR NOT EXISTS (SELECT 1 FROM external_event_required_departments r WHERE r.event_id=requested_event AND r.department=dept) THEN RAISE EXCEPTION 'responsible department approval required'; END IF;
      INSERT INTO external_event_approvals(event_id,department,approver_id,revision) VALUES(requested_event,dept,(SELECT auth.uid()),event_row.revision) ON CONFLICT DO NOTHING;
      SELECT count(*) INTO approval_count FROM external_event_approvals WHERE event_id=requested_event AND revision=event_row.revision;
      UPDATE external_event_packages SET status=CASE WHEN approval_count >= (SELECT count(*) FROM external_event_required_departments r WHERE r.event_id=requested_event) THEN 'email_review' ELSE 'department_review' END,updated_at=now() WHERE id=requested_event;
      IF approval_count >= (SELECT count(*) FROM external_event_required_departments r WHERE r.event_id=requested_event) THEN
        subject_value:='SADO endorsement request — '||(event_row.payload->>'title');
        body_value:='Organizer: '||(event_row.payload->>'organizer')||E'\nEvent: '||(event_row.payload->>'title')||E'\nSchedule: '||(event_row.payload->>'startAt')||' ('||(event_row.payload->>'timezone')||')'||E'\nVenue: '||(event_row.payload->>'venue')||E'\nSource: '||(event_row.payload->>'sourceUrl')||E'\n\n'||(event_row.payload->>'summary');
        hash_value:=encode(digest(subject_value||body_value,'sha256'),'hex');
        INSERT INTO external_event_mail(event_id,subject,body,revision_hash) VALUES(requested_event,subject_value,body_value,hash_value)
          ON CONFLICT(event_id) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,revision_hash=EXCLUDED.revision_hash,approved_by=NULL,approved_at=NULL,sent_at=NULL;
      END IF;
    ELSIF requested_action='record_sado_approval' THEN
      IF event_row.status<>'submitted_to_sado' OR length(trim(COALESCE(requested_detail,'')))<4 THEN RAISE EXCEPTION 'SADO response reference required'; END IF;
      INSERT INTO external_event_sado_proofs(event_id,recorded_by,reference) VALUES(requested_event,(SELECT auth.uid()),left(requested_detail,500));
      UPDATE external_event_packages SET status='sado_approved',updated_at=now() WHERE id=requested_event;
    ELSIF requested_action='confirm_manual_delivery' THEN
      IF event_row.status<>'email_review' OR length(trim(COALESCE(requested_detail,'')))<4
        OR NOT EXISTS (SELECT 1 FROM external_event_mail m WHERE m.event_id=requested_event AND m.delivery_mode='copy_export' AND m.delivery_status='exported')
        THEN RAISE EXCEPTION 'reviewed export and manual delivery reference required'; END IF;
      UPDATE external_event_mail SET provider_message_id=left(requested_detail,500) WHERE event_id=requested_event;
      UPDATE external_event_packages SET status='submitted_to_sado',updated_at=now() WHERE id=requested_event;
    ELSE RAISE EXCEPTION 'unsupported event action'; END IF;
  END IF;
  RETURN (SELECT item FROM jsonb_array_elements(external_event_feed()) item WHERE item->>'id'=requested_event::text LIMIT 1);
END; $$;

CREATE OR REPLACE FUNCTION claim_external_event_delivery(requested_event uuid, requested_key text, requested_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_status text; mail_status text; stored_key text;
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer authorization required'; END IF;
  IF requested_mode NOT IN ('copy_export','gmail') OR length(requested_key)<>64 THEN RAISE EXCEPTION 'invalid delivery request'; END IF;
  SELECT e.status,m.delivery_status,m.idempotency_key INTO event_status,mail_status,stored_key
    FROM external_event_packages e JOIN external_event_mail m ON m.event_id=e.id WHERE e.id=requested_event FOR UPDATE OF e,m;
  IF NOT FOUND OR event_status NOT IN ('email_review','submitted_to_sado') THEN RAISE EXCEPTION 'exact reviewed email not ready'; END IF;
  IF mail_status IN ('sent','exported') THEN
    IF stored_key IS DISTINCT FROM requested_key THEN RAISE EXCEPTION 'email revision changed'; END IF;
    RETURN jsonb_build_object('alreadyDelivered',true);
  END IF;
  IF mail_status='sending' THEN RAISE EXCEPTION 'delivery already in progress'; END IF;
  UPDATE external_event_mail SET delivery_mode=requested_mode,delivery_status='sending',idempotency_key=requested_key,
    approved_by=(SELECT auth.uid()),approved_at=now() WHERE event_id=requested_event;
  RETURN jsonb_build_object('alreadyDelivered',false);
END; $$;

CREATE OR REPLACE FUNCTION finish_external_event_delivery(requested_event uuid, requested_key text, requested_provider text, requested_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mode_value text;
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer authorization required'; END IF;
  SELECT delivery_mode INTO mode_value FROM external_event_mail WHERE event_id=requested_event AND idempotency_key=requested_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery claim not found'; END IF;
  IF requested_provider IS DISTINCT FROM mode_value THEN RAISE EXCEPTION 'delivery receipt mode mismatch'; END IF;
  UPDATE external_event_mail SET delivery_status=CASE WHEN mode_value='gmail' THEN 'sent' ELSE 'exported' END,
    provider=requested_provider,provider_message_id=left(requested_message,500),sent_at=now() WHERE event_id=requested_event;
  IF mode_value='gmail' THEN UPDATE external_event_packages SET status='submitted_to_sado',updated_at=now() WHERE id=requested_event; END IF;
END; $$;

CREATE OR REPLACE FUNCTION fail_external_event_delivery(requested_event uuid, requested_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (is_officer() OR is_admin()) THEN RAISE EXCEPTION 'officer authorization required'; END IF;
  UPDATE external_event_mail SET delivery_status='failed' WHERE event_id=requested_event AND idempotency_key=requested_key AND delivery_status='sending';
END; $$;

REVOKE ALL ON FUNCTION review_evidence_claim(uuid,text),submit_external_event(jsonb,department[]),external_event_feed(),accept_scraped_evidence(jsonb),transition_external_event(uuid,text,text),claim_external_event_delivery(uuid,text,text),finish_external_event_delivery(uuid,text,text,text),fail_external_event_delivery(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_evidence_claim(uuid,text),submit_external_event(jsonb,department[]),external_event_feed(),transition_external_event(uuid,text,text),claim_external_event_delivery(uuid,text,text),finish_external_event_delivery(uuid,text,text,text),fail_external_event_delivery(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_scraped_evidence(jsonb) TO service_role;
GRANT SELECT ON evidence_claims TO service_role;

COMMENT ON TABLE evidence_claims IS 'AI extracts claims; deterministic provenance or department review is the only verification authority.';
COMMENT ON TABLE external_event_packages IS 'Public external-event packages remain visibly unapproved until an officer records SADO proof.';
