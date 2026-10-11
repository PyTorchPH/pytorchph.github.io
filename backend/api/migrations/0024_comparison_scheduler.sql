ALTER TABLE skill_comparisons ADD COLUMN evidence_revision TEXT;
ALTER TABLE skill_comparisons ADD COLUMN scheduler_run_key TEXT;
CREATE UNIQUE INDEX scheduled_pair_revision ON skill_comparisons(skill_slug, member_a, member_b, evidence_revision)
  WHERE evidence_revision IS NOT NULL;

CREATE TABLE comparison_schedule_runs (
  run_key TEXT PRIMARY KEY,
  skill_slug TEXT NOT NULL REFERENCES skills(slug) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  created_pairs INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE comparison_validator_assignments (
  comparison_id TEXT NOT NULL REFERENCES skill_comparisons(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','review_required')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 3),
  flip INTEGER NOT NULL DEFAULT 0 CHECK (flip IN (0,1)),
  finished_at TEXT,
  PRIMARY KEY(comparison_id,validator_id)
);
CREATE INDEX comparison_validator_pending ON comparison_validator_assignments(validator_id,assigned_at);

CREATE TABLE comparison_assignment_audit (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES skill_comparisons(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('assigned','expired','completed','reassigned','review_required')),
  at TEXT NOT NULL
);
