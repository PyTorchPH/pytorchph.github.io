-- no-transaction
-- Deleting a member removes everything they own (sessions, points, claims, attendance,
-- roles, audit trail, approvals, portal state). Columns that only record which officer
-- acted on someone else's or the organization's data become nullable with SET NULL, so a
-- departing officer never takes other members' events, points, or mail with them.
-- SQLite cannot alter a foreign key, so each table is rebuilt (sqlite.org/lang_altertable.html,
-- "Making Other Kinds Of Table Schema Changes") with foreign keys off for this connection.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
INSERT INTO sessions_new SELECT token_hash, member_id, expires_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_member_idx ON sessions(member_id);

CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('talk','workshop','hackathon','competitive','mini_contest')),
  starts_at TEXT NOT NULL,
  competitive INTEGER NOT NULL CHECK (competitive IN (0,1)),
  entrant_kind TEXT CHECK (entrant_kind IN ('individual','team')),
  last_place INTEGER CHECK (last_place > 0),
  results_revision INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK ((competitive = 0 AND entrant_kind IS NULL AND last_place IS NULL)
      OR (competitive = 1 AND entrant_kind IS NOT NULL AND last_place IS NOT NULL)),
  CHECK ((category = 'mini_contest' AND parent_id IS NOT NULL)
      OR (category != 'mini_contest' AND parent_id IS NULL))
);
INSERT INTO events_new SELECT id, parent_id, title, category, starts_at, competitive, entrant_kind,
  last_place, results_revision, published_at, created_by, created_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_parent_idx ON events(parent_id);
CREATE INDEX events_created_by_idx ON events(created_by);

CREATE TABLE place_points_new (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  place INTEGER NOT NULL CHECK (place > 0),
  points INTEGER NOT NULL CHECK (points >= 0),
  PRIMARY KEY(event_id, place)
);
INSERT INTO place_points_new SELECT event_id, place, points FROM place_points;
DROP TABLE place_points;
ALTER TABLE place_points_new RENAME TO place_points;

CREATE TABLE entrants_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('individual','team')),
  UNIQUE(event_id, name)
);
INSERT INTO entrants_new SELECT id, event_id, name, kind FROM entrants;
DROP TABLE entrants;
ALTER TABLE entrants_new RENAME TO entrants;
CREATE INDEX entrants_event_idx ON entrants(event_id);

CREATE TABLE entrant_members_new (
  entrant_id TEXT NOT NULL REFERENCES entrants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY(entrant_id, member_id),
  UNIQUE(event_id, member_id)
);
INSERT INTO entrant_members_new SELECT entrant_id, event_id, member_id FROM entrant_members;
DROP TABLE entrant_members;
ALTER TABLE entrant_members_new RENAME TO entrant_members;
CREATE INDEX entrant_members_member_idx ON entrant_members(member_id);

CREATE TABLE results_new (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  place INTEGER NOT NULL CHECK (place > 0),
  entrant_id TEXT NOT NULL REFERENCES entrants(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  PRIMARY KEY(event_id, place),
  UNIQUE(event_id, entrant_id)
);
INSERT INTO results_new SELECT event_id, place, entrant_id, revision FROM results;
DROP TABLE results;
ALTER TABLE results_new RENAME TO results;
CREATE INDEX results_entrant_idx ON results(entrant_id);

CREATE TABLE point_ledger_new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'event_result',
  source_id TEXT,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  entrant_id TEXT REFERENCES entrants(id) ON DELETE CASCADE,
  place INTEGER,
  delta INTEGER NOT NULL,
  result_revision INTEGER,
  actor_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, member_id, result_revision, delta, place)
);
INSERT INTO point_ledger_new SELECT id, member_id, source_type, source_id, event_id, entrant_id,
  place, delta, result_revision, actor_id, reason, created_at FROM point_ledger;
DROP TABLE point_ledger;
ALTER TABLE point_ledger_new RENAME TO point_ledger;
CREATE INDEX ledger_member_idx ON point_ledger(member_id);
CREATE INDEX ledger_event_idx ON point_ledger(event_id);
CREATE INDEX ledger_entrant_idx ON point_ledger(entrant_id);
CREATE INDEX ledger_actor_idx ON point_ledger(actor_id);
CREATE UNIQUE INDEX ledger_non_event_unique ON point_ledger(source_type, source_id, member_id)
  WHERE source_type != 'event_result' AND delta > 0;

CREATE TABLE evidence_claims_new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('personal_project','external_talk','external_competition','external_participation')),
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','github','facebook','linkedin')),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','extension_scrape')),
  submitted_text TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  points INTEGER,
  reviewed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  review_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(member_id, content_hash)
);
INSERT INTO evidence_claims_new SELECT id, member_id, kind, title, source_url, source, origin,
  submitted_text, content_hash, status, points, reviewed_by, review_reason, created_at, reviewed_at
  FROM evidence_claims;
DROP TABLE evidence_claims;
ALTER TABLE evidence_claims_new RENAME TO evidence_claims;
CREATE INDEX evidence_pending_idx ON evidence_claims(status, created_at);
CREATE INDEX evidence_reviewer_idx ON evidence_claims(reviewed_by);

CREATE TABLE audit_events_new (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER,
  created_at TEXT NOT NULL
);
INSERT INTO audit_events_new SELECT id, actor_id, operation, entity_id, revision, created_at FROM audit_events;
DROP TABLE audit_events;
ALTER TABLE audit_events_new RENAME TO audit_events;
CREATE INDEX audit_actor_idx ON audit_events(actor_id);

CREATE TABLE leaderboard_cache_new (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);
INSERT INTO leaderboard_cache_new SELECT member_id, points, refreshed_at FROM leaderboard_cache;
DROP TABLE leaderboard_cache;
ALTER TABLE leaderboard_cache_new RENAME TO leaderboard_cache;

CREATE TABLE attendance_sources_new (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 1000),
  configured_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_imported_at TEXT
);
INSERT INTO attendance_sources_new SELECT event_id, form_id, points, configured_by, created_at,
  last_imported_at FROM attendance_sources;
DROP TABLE attendance_sources;
ALTER TABLE attendance_sources_new RENAME TO attendance_sources;

CREATE TABLE attendance_responses_new (
  form_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submitted_at TEXT NOT NULL,
  normalized_email TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('awarded','unmatched','duplicate_member')),
  imported_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY(form_id, response_id)
);
INSERT INTO attendance_responses_new SELECT form_id, response_id, event_id, submitted_at,
  normalized_email, member_id, status, imported_by, imported_at FROM attendance_responses;
DROP TABLE attendance_responses;
ALTER TABLE attendance_responses_new RENAME TO attendance_responses;
CREATE INDEX attendance_event_idx ON attendance_responses(event_id, submitted_at);
CREATE INDEX attendance_member_idx ON attendance_responses(member_id);
CREATE UNIQUE INDEX attendance_one_award_per_member ON attendance_responses(event_id, member_id)
  WHERE status = 'awarded';

CREATE TABLE officer_roles_new (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ambassador','secretariat','treasurer','external_relations','academics','executive','campus_lead')),
  PRIMARY KEY(member_id, role)
);
INSERT INTO officer_roles_new SELECT member_id, role FROM officer_roles;
DROP TABLE officer_roles;
ALTER TABLE officer_roles_new RENAME TO officer_roles;

CREATE TABLE mail_routes_new (
  category TEXT PRIMARY KEY,
  required_roles_json TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  updated_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO mail_routes_new SELECT category, required_roles_json, sender_role, updated_by, updated_at FROM mail_routes;
DROP TABLE mail_routes;
ALTER TABLE mail_routes_new RENAME TO mail_routes;

CREATE TABLE mail_drafts_new (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL REFERENCES mail_routes(category) ON DELETE CASCADE,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  current_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','released','sent','uncertain','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO mail_drafts_new SELECT id, category, created_by, current_revision, status, created_at, updated_at FROM mail_drafts;
DROP TABLE mail_drafts;
ALTER TABLE mail_drafts_new RENAME TO mail_drafts;
CREATE INDEX mail_drafts_category_idx ON mail_drafts(category);
CREATE INDEX mail_drafts_creator_idx ON mail_drafts(created_by);

CREATE TABLE mail_revisions_new (
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  pdf_text TEXT,
  pdf_bytes BLOB,
  pdf_sha256 TEXT,
  content_hash TEXT NOT NULL,
  required_roles_json TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  edited_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision)
);
INSERT INTO mail_revisions_new SELECT draft_id, revision, recipients_json, subject, body, pdf_text,
  pdf_bytes, pdf_sha256, content_hash, required_roles_json, sender_role, edited_by, created_at
  FROM mail_revisions;
DROP TABLE mail_revisions;
ALTER TABLE mail_revisions_new RENAME TO mail_revisions;

CREATE TABLE mail_approvals_new (
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  role TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision, role),
  FOREIGN KEY(draft_id, revision) REFERENCES mail_revisions(draft_id, revision) ON DELETE CASCADE
);
INSERT INTO mail_approvals_new SELECT draft_id, revision, role, approver_id, created_at FROM mail_approvals;
DROP TABLE mail_approvals;
ALTER TABLE mail_approvals_new RENAME TO mail_approvals;
CREATE INDEX mail_approvals_approver_idx ON mail_approvals(approver_id);

CREATE TABLE mail_dispatch_new (
  draft_id TEXT PRIMARY KEY REFERENCES mail_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent','uncertain','failed')),
  claimed_at TEXT,
  external_message_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(draft_id, revision) REFERENCES mail_revisions(draft_id, revision) ON DELETE CASCADE
);
INSERT INTO mail_dispatch_new SELECT draft_id, revision, content_hash, status, claimed_at,
  external_message_id, updated_at FROM mail_dispatch;
DROP TABLE mail_dispatch;
ALTER TABLE mail_dispatch_new RENAME TO mail_dispatch;

CREATE TABLE mail_reconciliations_new (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent','uncertain','failed')),
  reason TEXT NOT NULL,
  external_message_id TEXT,
  actor_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
INSERT INTO mail_reconciliations_new SELECT id, draft_id, status, reason, external_message_id,
  actor_id, created_at FROM mail_reconciliations;
DROP TABLE mail_reconciliations;
ALTER TABLE mail_reconciliations_new RENAME TO mail_reconciliations;
CREATE INDEX mail_reconciliations_draft_idx ON mail_reconciliations(draft_id, created_at);

-- portal_state.scope is a member id or the organization scope, so it cannot carry a
-- foreign key; this trigger gives member-scoped rows the same cascade.
CREATE TRIGGER members_delete_portal_state AFTER DELETE ON members
BEGIN
  DELETE FROM portal_state WHERE scope = OLD.id;
END;

COMMIT;
PRAGMA foreign_keys = ON;
