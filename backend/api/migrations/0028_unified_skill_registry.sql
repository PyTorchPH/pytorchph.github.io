-- One active skill catalog shared by events, evidence, leaderboards, job matching, and UI pickers.
-- Historical rows keep their foreign keys when a skill is retired.
ALTER TABLE skills ADD COLUMN category TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE skills ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired'));
ALTER TABLE skills ADD COLUMN created_by TEXT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE skills ADD COLUMN created_at TEXT NOT NULL DEFAULT '';

CREATE TABLE skill_aliases (
  alias TEXT PRIMARY KEY CHECK (length(alias) BETWEEN 1 AND 80),
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE CASCADE,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

INSERT INTO skill_aliases(alias,skill_slug,created_at)
SELECT lower(trim(label)),slug,'migration-0028' FROM skills;
INSERT OR IGNORE INTO skill_aliases(alias,skill_slug,created_at)
SELECT lower(trim(slug)),slug,'migration-0028' FROM skills;

CREATE TABLE skill_candidates (
  id TEXT PRIMARY KEY,
  raw TEXT NOT NULL CHECK (length(trim(raw)) BETWEEN 1 AND 80),
  normalized TEXT NOT NULL CHECK (length(normalized) BETWEEN 1 AND 80),
  suggested_category TEXT NOT NULL DEFAULT 'Other' CHECK (length(trim(suggested_category)) BETWEEN 1 AND 80),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('evidence','event','job_tag','manual')),
  source_id TEXT,
  submitted_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','mapped','rejected')),
  mapped_skill_slug TEXT REFERENCES skills(slug) ON DELETE SET NULL,
  reviewed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  review_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE UNIQUE INDEX skill_candidates_pending_raw ON skill_candidates(normalized) WHERE state='pending';
CREATE INDEX skill_candidates_state_created ON skill_candidates(state,created_at);

CREATE TABLE evidence_claim_skills (
  claim_id TEXT NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL CHECK (ord >= 0),
  raw TEXT NOT NULL CHECK (length(trim(raw)) BETWEEN 1 AND 80),
  skill_slug TEXT REFERENCES skills(slug) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES skill_candidates(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('matched','pending','rejected')),
  PRIMARY KEY (claim_id,ord)
);
CREATE INDEX evidence_claim_skills_skill ON evidence_claim_skills(skill_slug,claim_id);
CREATE INDEX evidence_claim_skills_candidate ON evidence_claim_skills(candidate_id);

CREATE TABLE event_skill_candidates (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES skill_candidates(id) ON DELETE CASCADE,
  allocation_bps INTEGER NOT NULL CHECK (allocation_bps BETWEEN 1 AND 10000),
  PRIMARY KEY(event_id,candidate_id)
);
