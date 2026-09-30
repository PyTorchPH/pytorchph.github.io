-- Deleting an event removes it for good (entrants, results, attendance, and the points it
-- awarded cascade away), but a snapshot of what was removed stays here. No foreign keys, so the
-- record survives the event, its creator, and the officer who deleted it.
-- Visible to the event's creator, the officer who deleted it, and admins.
CREATE TABLE event_deletion_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  deleted_by_name TEXT NOT NULL,
  child_events INTEGER NOT NULL CHECK (child_events >= 0),
  entrants INTEGER NOT NULL CHECK (entrants >= 0),
  results INTEGER NOT NULL CHECK (results >= 0),
  attendance_responses INTEGER NOT NULL CHECK (attendance_responses >= 0),
  points_revoked INTEGER NOT NULL,
  members_affected INTEGER NOT NULL CHECK (members_affected >= 0),
  deleted_at TEXT NOT NULL
);
CREATE INDEX event_deletion_log_people_idx ON event_deletion_log(created_by, deleted_by);
