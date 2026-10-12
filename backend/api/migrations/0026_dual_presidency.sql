-- Two equal-authority holders; the existing president slug retains all permissions.
UPDATE positions SET title = 'President / PyTorch Ambassador', seats = 'many' WHERE slug = 'president';
CREATE TRIGGER president_seat_insert BEFORE INSERT ON member_positions
WHEN NEW.position_slug = 'president' AND NOT EXISTS (
  SELECT 1 FROM member_positions WHERE position_slug = 'president' AND member_id = NEW.member_id
) AND (SELECT COUNT(*) FROM member_positions WHERE position_slug = 'president') >= 2
BEGIN SELECT RAISE(ABORT, 'Both presidential seats are filled'); END;
CREATE TRIGGER president_seat_update BEFORE UPDATE ON member_positions
WHEN NEW.position_slug = 'president' AND (
  SELECT COUNT(*) FROM member_positions WHERE position_slug = 'president'
  AND NOT (member_id = OLD.member_id AND position_slug = OLD.position_slug)
) >= 2
BEGIN SELECT RAISE(ABORT, 'Both presidential seats are filled'); END;

CREATE TABLE presidential_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  required_approvals INTEGER NOT NULL CHECK (required_approvals IN (1, 2))
);
INSERT INTO presidential_policy VALUES (1, 2);

-- Keep prior approvals; one actor can never supply two votes for the same content.
CREATE TABLE collab_approvals_new (
  draft_id TEXT NOT NULL REFERENCES collab_drafts(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('secretariat', 'president')),
  approver_id TEXT NOT NULL,
  assembled_hash TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, step, approver_id)
);
INSERT INTO collab_approvals_new SELECT * FROM collab_approvals;
DROP TABLE collab_approvals;
ALTER TABLE collab_approvals_new RENAME TO collab_approvals;

CREATE TABLE mail_approvals_new (
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  role TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, revision, role, approver_id),
  FOREIGN KEY (draft_id, revision) REFERENCES mail_revisions(draft_id, revision) ON DELETE CASCADE
);
INSERT INTO mail_approvals_new SELECT * FROM mail_approvals;
DROP TABLE mail_approvals;
ALTER TABLE mail_approvals_new RENAME TO mail_approvals;
CREATE INDEX mail_approvals_approver_idx ON mail_approvals(approver_id);
