-- One positive award store. Historical signed corrections are folded into their net
-- active award; the old ledger is removed after the copy succeeds.
CREATE TABLE point_awards (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  entrant_id TEXT REFERENCES entrants(id) ON DELETE CASCADE,
  place INTEGER,
  base_points INTEGER NOT NULL CHECK (base_points > 0),
  weight_milli INTEGER NOT NULL DEFAULT 1000 CHECK (weight_milli BETWEEN 1 AND 10000),
  weighted_points INTEGER GENERATED ALWAYS AS ((base_points * weight_milli + 500) / 1000) STORED,
  model_version INTEGER,
  result_revision INTEGER,
  actor_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX point_awards_source_unique ON point_awards(source_type, source_id, member_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX point_awards_member_date ON point_awards(member_id, earned_at);
CREATE INDEX point_awards_event ON point_awards(event_id);

INSERT INTO point_awards(id,member_id,source_type,source_id,event_id,entrant_id,place,base_points,
                         result_revision,actor_id,reason,earned_at,created_at)
SELECT lower(hex(randomblob(16))), l.member_id, l.source_type, l.source_id, l.event_id,
       (SELECT q.entrant_id FROM point_ledger q WHERE q.member_id=l.member_id
        AND q.event_id IS l.event_id AND q.source_type=l.source_type
        AND q.source_id IS l.source_id AND q.delta>0
        ORDER BY q.result_revision DESC, q.created_at DESC LIMIT 1),
       (SELECT q.place FROM point_ledger q WHERE q.member_id=l.member_id
        AND q.event_id IS l.event_id AND q.source_type=l.source_type
        AND q.source_id IS l.source_id AND q.delta>0
        ORDER BY q.result_revision DESC, q.created_at DESC LIMIT 1),
       SUM(l.delta), MAX(l.result_revision), MAX(l.actor_id), 'migrated_net_award',
       MAX(l.created_at), MAX(l.created_at)
FROM point_ledger l
GROUP BY l.member_id,l.source_type,l.source_id,l.event_id
HAVING SUM(l.delta)>0;
DROP TABLE point_ledger;

INSERT OR IGNORE INTO skills(slug,label) VALUES ('ml','Machine Learning'),('mathematics','Mathematics');

CREATE TABLE scoring_model_versions (
  version INTEGER PRIMARY KEY,
  coefficients_json TEXT NOT NULL CHECK (json_valid(coefficients_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  training_votes INTEGER NOT NULL CHECK (training_votes > 0),
  published_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE event_scoring (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  weight_milli INTEGER NOT NULL CHECK (weight_milli BETWEEN 1 AND 10000),
  model_version INTEGER REFERENCES scoring_model_versions(version),
  selected_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  decision_reason TEXT NOT NULL,
  selected_at TEXT NOT NULL
);
INSERT INTO event_scoring(event_id,weight_milli,selected_by,decision_reason,selected_at)
SELECT id,1000,created_by,'legacy_migration',created_at FROM events;
CREATE TABLE event_skill_tags (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE RESTRICT,
  allocation_bps INTEGER NOT NULL CHECK (allocation_bps BETWEEN 1 AND 10000),
  PRIMARY KEY(event_id,skill_slug)
);

CREATE TABLE scoring_validators (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE RESTRICT,
  assigned_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(member_id,skill_slug)
);
CREATE TABLE skill_comparisons (
  id TEXT PRIMARY KEY,
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE RESTRICT,
  member_a TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_b TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  evidence_cutoff TEXT NOT NULL,
  evidence_a_json TEXT NOT NULL CHECK (json_valid(evidence_a_json)),
  evidence_b_json TEXT NOT NULL CHECK (json_valid(evidence_b_json)),
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (member_a < member_b)
);
CREATE TABLE skill_comparison_votes (
  comparison_id TEXT NOT NULL REFERENCES skill_comparisons(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('a','draw','b')),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(comparison_id,validator_id)
);
CREATE INDEX comparisons_skill ON skill_comparisons(skill_slug,created_at);
