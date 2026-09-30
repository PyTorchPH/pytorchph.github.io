-- Officers assign positions down the org chart: whoever holds a position may assign, and remove,
-- holders of the positions that report directly to it; anyone may resign their own position.
-- There is no admin bypass in the app; the developer repairs the chart through migrations.

-- Heads hold their position alone; officer-level positions can be shared.
ALTER TABLE positions ADD COLUMN seats TEXT NOT NULL DEFAULT 'one' CHECK (seats IN ('one', 'many'));
UPDATE positions SET seats = 'many' WHERE slug IN (
  'foundation_ambassador', 'operations_officer', 'communications_officer',
  'community_outreach_officer', 'learning_programs_officer'
);

-- Campus Lab Ambassadors work with the Campus Labs Lead from the outreach side.
INSERT INTO positions(slug, title, department_slug, rank, seats)
VALUES ('campus_lab_ambassador', 'Campus Lab Ambassador', 'outreach', 4, 'many');
INSERT INTO position_reports_to(position_slug, reports_to_slug)
VALUES ('campus_lab_ambassador', 'head_partnerships_outreach');

-- Every assignment, removal, and resignation, kept even after members or positions are gone
-- (no foreign keys), so the history stays auditable.
CREATE TABLE position_assignment_log (
  id TEXT PRIMARY KEY,
  position_slug TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('assigned', 'removed', 'resigned')),
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX position_assignment_log_position_idx ON position_assignment_log(position_slug, at);
