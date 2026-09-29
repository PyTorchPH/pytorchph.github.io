-- Leaderboard seasons, rank tiers, skills, evidence rubric, officer claim reviews,
-- integrity sanctions and appeals. Normalized: nothing derivable is stored (a season's
-- state comes from its dates, an appeal's member from its sanction, a claim's points
-- from the published rubric). Rows owned by a member cascade with the member; columns
-- naming the acting officer are SET NULL so other members' records survive.

-- Sample rows are removable in one statement: DELETE FROM members WHERE is_sample = 1.
ALTER TABLE members ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1));

CREATE TABLE point_rubric_versions (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  label TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE point_rubric_levels (
  rubric_version INTEGER NOT NULL REFERENCES point_rubric_versions(version) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('participation','contributor','finalist_lead','winner_top_award')),
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 100),
  PRIMARY KEY (rubric_version, level)
);

INSERT INTO point_rubric_versions(version, label, published_at)
  VALUES (1, 'Evidence level matrix v1', '2026-09-29T00:00:00Z');
INSERT INTO point_rubric_levels VALUES
  (1,'participation',1),(1,'contributor',2),(1,'finalist_lead',3),(1,'winner_top_award',4);

-- History of officer decisions; the claim row keeps only its current status.
CREATE TABLE evidence_claim_reviews (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve','scraper_defect','reject_unsupported','confirm_falsification','confirm_tampering')),
  verified_level TEXT CHECK (verified_level IN ('participation','contributor','finalist_lead','winner_top_award')),
  rubric_version INTEGER REFERENCES point_rubric_versions(version) ON DELETE SET NULL,
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 4 AND 1200),
  claim_hash TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  CHECK ((decision = 'approve') = (verified_level IS NOT NULL))
);
CREATE INDEX evidence_reviews_claim_idx ON evidence_claim_reviews(claim_id, reviewed_at);
CREATE INDEX evidence_reviews_reviewer_idx ON evidence_claim_reviews(reviewer_id);

CREATE TABLE leaderboard_sanctions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL CHECK (violation_type IN ('manual_falsification','scraper_tampering')),
  safe_reason TEXT NOT NULL CHECK (length(trim(safe_reason)) BETWEEN 4 AND 1200),
  imposed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  imposed_at TEXT NOT NULL,
  lifted_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  lifted_at TEXT
);
CREATE UNIQUE INDEX one_active_leaderboard_sanction ON leaderboard_sanctions(member_id) WHERE lifted_at IS NULL;
CREATE INDEX sanctions_claim_idx ON leaderboard_sanctions(claim_id);
CREATE INDEX sanctions_imposed_by_idx ON leaderboard_sanctions(imposed_by);
CREATE INDEX sanctions_lifted_by_idx ON leaderboard_sanctions(lifted_by);

CREATE TABLE evidence_appeals (
  id TEXT PRIMARY KEY,
  sanction_id TEXT NOT NULL REFERENCES leaderboard_sanctions(id) ON DELETE CASCADE,
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 10 AND 1200),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','restored','upheld')),
  decided_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(trim(decision_reason)) BETWEEN 4 AND 1200),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((state = 'open') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX one_open_evidence_appeal ON evidence_appeals(sanction_id) WHERE state = 'open';
CREATE INDEX appeals_decided_by_idx ON evidence_appeals(decided_by);

CREATE TABLE leaderboard_seasons (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 3 AND 40),
  label TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
INSERT INTO leaderboard_seasons VALUES
  ('2026-q3','2026 Quarter 3','2026-07-01T00:00:00+08:00','2026-10-01T00:00:00+08:00'),
  ('2026-q4','2026 Quarter 4','2026-10-01T00:00:00+08:00','2027-01-01T00:00:00+08:00');

CREATE TABLE rank_tiers (
  tier TEXT PRIMARY KEY,
  min_points INTEGER NOT NULL UNIQUE CHECK (min_points >= 0)
);
INSERT INTO rank_tiers VALUES
  ('Iron',0),('Bronze',100),('Silver',300),('Gold',700),('Platinum',1300),('Diamond',2200),('Master',3500);

CREATE TABLE skills (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 1 AND 40),
  label TEXT NOT NULL UNIQUE
);
INSERT INTO skills VALUES
  ('python','Python'),('pytorch','PyTorch'),('fastapi','FastAPI'),('react','React'),('sql','SQL'),
  ('computer-vision','Computer Vision'),('data-engineering','Data Engineering'),('nlp','NLP'),
  ('mentoring','Mentoring'),('research','Research');

CREATE TABLE member_skills (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE CASCADE,
  verified_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (member_id, skill_slug)
);
CREATE INDEX member_skills_skill_idx ON member_skills(skill_slug);
CREATE INDEX member_skills_verified_by_idx ON member_skills(verified_by);
