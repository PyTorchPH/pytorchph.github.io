-- Deterministic synthetic showcase data. Never run against a real production project.
-- Local password for every synthetic auth account: demo-password

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
  crypt('demo-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', display_name, 'demo_data', true), now(), now()
FROM (VALUES
  ('00000000-0000-4000-8000-000000000001'::uuid, 'demo.owner@fit.edu.ph', 'Alex Rivera'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 'mika@fit.edu.ph', 'Mika Santos'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 'jules@fit.edu.ph', 'Jules Cruz'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 'ari@fit.edu.ph', 'Ari Reyes'),
  ('00000000-0000-4000-8000-000000000104'::uuid, 'nia@fit.edu.ph', 'Nia Lim'),
  ('00000000-0000-4000-8000-000000000105'::uuid, 'ren@fit.edu.ph', 'Ren Garcia'),
  ('00000000-0000-4000-8000-000000000106'::uuid, 'sam@fit.edu.ph', 'Sam Flores'),
  ('00000000-0000-4000-8000-000000000107'::uuid, 'kai@fit.edu.ph', 'Kai Mendoza'),
  ('00000000-0000-4000-8000-000000000108'::uuid, 'lee@fit.edu.ph', 'Lee Navarro'),
  ('00000000-0000-4000-8000-000000000109'::uuid, 'rio@fit.edu.ph', 'Rio Torres'),
  ('00000000-0000-4000-8000-000000000110'::uuid, 'aya@fit.edu.ph', 'Aya Ramos'),
  ('00000000-0000-4000-8000-000000000111'::uuid, 'noa@fit.edu.ph', 'Noa Bautista')
) AS demo(id, email, display_name)
ON CONFLICT (id) DO UPDATE SET raw_user_meta_data = EXCLUDED.raw_user_meta_data, updated_at = now();

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT id, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', id::text, now(), now(), now()
FROM auth.users WHERE raw_user_meta_data ->> 'demo_data' = 'true'
ON CONFLICT (provider_id, provider) DO NOTHING;

UPDATE member_profiles SET
  nickname = CASE id
    WHEN '00000000-0000-4000-8000-000000000001' THEN 'Alex #D3M0'
    WHEN '00000000-0000-4000-8000-000000000101' THEN 'Mika #7A82F'
    WHEN '00000000-0000-4000-8000-000000000102' THEN 'Jules #29C10'
    WHEN '00000000-0000-4000-8000-000000000103' THEN 'Ari #4D91B'
    WHEN '00000000-0000-4000-8000-000000000104' THEN 'Nia #88E2A'
    WHEN '00000000-0000-4000-8000-000000000105' THEN 'Ren #95F0C'
    WHEN '00000000-0000-4000-8000-000000000106' THEN 'Sam #14F8D'
    WHEN '00000000-0000-4000-8000-000000000107' THEN 'Kai #2CB71'
    WHEN '00000000-0000-4000-8000-000000000108' THEN 'Lee #67A03'
    WHEN '00000000-0000-4000-8000-000000000109' THEN 'Rio #A12E9'
    WHEN '00000000-0000-4000-8000-000000000110' THEN 'Aya #550BF'
    ELSE 'Noa #B314C' END,
  bio = 'Synthetic member profile for the PyTorch PH visual showcase.',
  is_officer = id IN ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'),
  officer_department = CASE id
    WHEN '00000000-0000-4000-8000-000000000101' THEN 'academics'::department
    WHEN '00000000-0000-4000-8000-000000000102' THEN 'external_relations'::department
    WHEN '00000000-0000-4000-8000-000000000103' THEN 'treasurer'::department
    ELSE NULL END
WHERE id IN (SELECT id FROM auth.users WHERE raw_user_meta_data ->> 'demo_data' = 'true');

INSERT INTO activities (id, category, scope, title, pipeline_status, created_by) VALUES
  ('10000000-0000-4000-8000-000000000001', 'hackathons', 'internal', 'PyTorch Hack Night', 'approving', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'workshops', 'internal', 'Computer Vision Basics Workshop', 'approved', '00000000-0000-4000-8000-000000000101'),
  ('10000000-0000-4000-8000-000000000003', 'events', 'external', 'Innovation Center Demo Night', 'briefing', '00000000-0000-4000-8000-000000000102'),
  ('10000000-0000-4000-8000-000000000004', 'competitive_programming', 'external', 'Campus Model Optimization Sprint', 'routing', '00000000-0000-4000-8000-000000000103')
ON CONFLICT (id) DO UPDATE SET pipeline_status = EXCLUDED.pipeline_status, updated_at = now();

INSERT INTO department_briefs (activity_id, department, recipient, required_content, draft) VALUES
  ('10000000-0000-4000-8000-000000000001', 'academics', 'Academic Affairs officer', 'Learning outcomes and mentor coverage', 'Synthetic AI draft awaiting officer review.'),
  ('10000000-0000-4000-8000-000000000001', 'treasurer', 'Treasurer', 'Budget and purchase constraints', 'Synthetic budget brief awaiting human approval.'),
  ('10000000-0000-4000-8000-000000000003', 'external_relations', 'External Relations officer', 'Partner and public communication plan', 'Synthetic partner brief awaiting copy review.')
ON CONFLICT (activity_id, department) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now();

INSERT INTO approvals (activity_id, department, approver_user_id, decision, note) VALUES
  ('10000000-0000-4000-8000-000000000001', 'academics', '00000000-0000-4000-8000-000000000101', 'approve', 'Synthetic approval for demo analytics.'),
  ('10000000-0000-4000-8000-000000000001', 'treasurer', '00000000-0000-4000-8000-000000000103', 'edit', 'Clarify the equipment budget before approval.'),
  ('10000000-0000-4000-8000-000000000003', 'external_relations', '00000000-0000-4000-8000-000000000102', 'edit', 'Human copy review is still required.')
ON CONFLICT (activity_id, department) DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note, decided_at = now();

INSERT INTO point_events (id, member_id, source, points, weight, description, earned_at)
SELECT ('20000000-0000-4000-8000-' || lpad(row_number() OVER ()::text, 12, '0'))::uuid,
  member_id, source::point_source, points, weight, description, now() - earned_offset
FROM (VALUES
  ('00000000-0000-4000-8000-000000000101'::uuid, 'achievement', 210::numeric, 3::numeric, 'Vision project recognition', interval '28 days'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 'project', 180::numeric, 2::numeric, 'Campus vision demo', interval '12 days'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 'competition', 240::numeric, 2::numeric, 'Model optimization finalist', interval '24 days'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 'activity', 170::numeric, 1::numeric, 'Workshop facilitation', interval '5 days'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 'project', 220::numeric, 2::numeric, 'NLP community project', interval '18 days'),
  ('00000000-0000-4000-8000-000000000104'::uuid, 'grade', 160::numeric, 2.5::numeric, 'Verified academic highlight', interval '31 days'),
  ('00000000-0000-4000-8000-000000000105'::uuid, 'project', 190::numeric, 2::numeric, 'MLOps portfolio system', interval '14 days'),
  ('00000000-0000-4000-8000-000000000106'::uuid, 'activity', 260::numeric, 1::numeric, 'Peer mentoring series', interval '9 days'),
  ('00000000-0000-4000-8000-000000000107'::uuid, 'competition', 150::numeric, 2::numeric, 'Hackathon prototype', interval '7 days'),
  ('00000000-0000-4000-8000-000000000108'::uuid, 'project', 140::numeric, 2::numeric, 'Data ethics review tool', interval '3 days'),
  ('00000000-0000-4000-8000-000000000109'::uuid, 'referral', 320::numeric, .5::numeric, 'Chapter referrals', interval '16 days'),
  ('00000000-0000-4000-8000-000000000110'::uuid, 'activity', 180::numeric, 1::numeric, 'Research reading group', interval '2 days')
) AS events(member_id, source, points, weight, description, earned_offset)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO skills (id, slug, display_name, category, status, source) VALUES
  ('30000000-0000-4000-8000-000000000001', 'python', 'Python', 'programming', 'approved', 'preset'),
  ('30000000-0000-4000-8000-000000000002', 'pytorch', 'PyTorch', 'machine-learning', 'approved', 'preset'),
  ('30000000-0000-4000-8000-000000000003', 'react', 'React', 'web-frontend', 'approved', 'preset'),
  ('30000000-0000-4000-8000-000000000004', 'fastapi', 'FastAPI', 'web-backend', 'approved', 'preset'),
  ('30000000-0000-4000-8000-000000000005', 'data-ethics', 'Data Ethics', 'responsible-ai', 'approved', 'preset')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO member_skills (member_id, skill_id, skill_points)
SELECT member_id, skill_id, points FROM (VALUES
  ('00000000-0000-4000-8000-000000000101'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 990::numeric),
  ('00000000-0000-4000-8000-000000000102'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 820::numeric),
  ('00000000-0000-4000-8000-000000000103'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, 760::numeric),
  ('00000000-0000-4000-8000-000000000104'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 690::numeric),
  ('00000000-0000-4000-8000-000000000105'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, 650::numeric)
) AS rows(member_id, skill_id, points)
ON CONFLICT (member_id, skill_id) DO UPDATE SET skill_points = EXCLUDED.skill_points, last_updated_at = now();

INSERT INTO career_evidence_sources (id, user_id, label, source_kind, verification_state, provider_key, connection_state, maturity, connection_method, description, permissions, last_synced_at) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'GitHub', 'project', 'verified', 'github', 'connected', 'available', 'website_session', 'Website-first project evidence.', '["Read public projects","Read contribution metadata"]', now()),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'LinkedIn', 'post', 'ready', 'linkedin', 'connected', 'available', 'website_session', 'User-approved professional evidence.', '["Read visible profile","Read selected posts"]', now() - interval '2 days'),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Photos & documents', 'document', 'verified', 'upload', 'connected', 'available', 'upload', 'Private user-selected evidence.', '["Store selected files privately"]', now())
ON CONFLICT (id) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at, updated_at = now();

INSERT INTO career_evidence_items (id, user_id, source_id, evidence_kind, label, normalized_value, is_verified, title, organization, role_label, date_label, description, quantitative_results, qualitative_results, skill_tags, review_state, confidence, source_url) VALUES
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'project', 'Campus Vision Demo', 'Presented an image-classification prototype.', true, 'Presented an ML project at a campus showcase', 'University Innovation Lab', 'Machine Learning Developer', 'March 2026', 'Built and presented an image-classification prototype.', '["Evaluated the prototype on 1,200 labelled images from the approved project dataset."]', '["Translated model behavior into a clear demonstration."]', '["Python","PyTorch","Computer Vision"]', 'user_verified', 96, 'https://github.com/example/campus-vision-demo'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'experience', 'Workshop facilitation', 'Facilitated a hands-on programming workshop.', false, 'Facilitated a hands-on programming workshop', 'AI Study Circles', 'Workshop Facilitator', 'May 2026', 'Guided participants through a model-training exercise.', '[]', '["Resolved participant setup and debugging issues."]', '["Python","Teaching","PyTorch"]', 'ai_proposed', 88, NULL),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'project', 'Responsible prototype', 'Completed an ethical AI hackathon prototype.', false, 'Completed an ethical AI hackathon prototype', 'Campus AI Hack Night', 'Prototype Team Member', 'July 2026', 'Collaborated on a prototype with documented limitations.', '[]', '["Connected implementation with responsible-use review."]', '["Teamwork","Prototyping","Data Ethics"]', 'source_matched', 91, NULL)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, review_state = EXCLUDED.review_state, updated_at = now();

INSERT INTO career_evidence_media (id, user_id, evidence_item_id, storage_path, alt_text, exif_stripped, is_demo_fixture) VALUES
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001/ml-showcase.webp', 'Synthetic ML showcase evidence photo', true, true),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001/workshop-facilitation.webp', 'Synthetic workshop evidence photo', true, true),
  ('60000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001/hackathon-team.webp', 'Synthetic hackathon evidence photo', true, true)
ON CONFLICT (id) DO UPDATE SET alt_text = EXCLUDED.alt_text;

INSERT INTO resume_artifacts (user_id, role_id, label, summary, skill_group_count, project_count, artifact_ready) VALUES
  ('00000000-0000-4000-8000-000000000001', 'software-systems', 'Software Systems', 'Backend, web, and automation evidence.', 3, 2, true),
  ('00000000-0000-4000-8000-000000000001', 'machine-learning', 'Machine Learning', 'PyTorch, data, and model-development evidence.', 3, 2, true)
ON CONFLICT (user_id, role_id) DO UPDATE SET artifact_ready = true, updated_at = now();

INSERT INTO application_goals (id, user_id, label, target, completed, active_workers) VALUES
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Reviewed applications', 10, 3, 0)
ON CONFLICT (id) DO UPDATE SET completed = EXCLUDED.completed, updated_at = now();

INSERT INTO application_review_items (id, user_id, goal_id, title, detail, state, human_gate) VALUES
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Resume selection', 'Confirm the role-specific artifact before upload.', 'waiting', true),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Job-site verification', 'Complete verification in a visible browser.', 'blocked', true)
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now();

INSERT INTO connection_summaries (user_id, provider_key, label, category, state, detail) VALUES
  ('00000000-0000-4000-8000-000000000001', 'supabase', 'Supabase showcase', 'database', 'connected', 'Separate demo project; server-gateway reads only.'),
  ('00000000-0000-4000-8000-000000000001', 'github', 'GitHub', 'identity', 'connected', 'Approved development fixture.'),
  ('00000000-0000-4000-8000-000000000001', 'linkedin', 'LinkedIn evidence', 'social', 'connected', 'User-approved visible session.'),
  ('00000000-0000-4000-8000-000000000001', 'facebook', 'Facebook evidence', 'social', 'verification_required', 'Human verification required.'),
  ('00000000-0000-4000-8000-000000000001', 'indeed', 'Indeed', 'job_site', 'verification_required', 'Human verification required before automation.')
ON CONFLICT (user_id, provider_key) DO UPDATE SET state = EXCLUDED.state, detail = EXCLUDED.detail, checked_at = now();

REFRESH MATERIALIZED VIEW leaderboard;
REFRESH MATERIALIZED VIEW skill_leaderboard;
