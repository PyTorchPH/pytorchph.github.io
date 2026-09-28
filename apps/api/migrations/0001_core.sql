PRAGMA foreign_keys = ON;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  public_handle TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'pending' CHECK (role IN ('pending','member','officer','admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_member_idx ON sessions(member_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES events(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('talk','workshop','hackathon','competitive','mini_contest')),
  starts_at TEXT NOT NULL,
  competitive INTEGER NOT NULL CHECK (competitive IN (0,1)),
  entrant_kind TEXT CHECK (entrant_kind IN ('individual','team')),
  last_place INTEGER CHECK (last_place > 0),
  results_revision INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  CHECK ((competitive = 0 AND entrant_kind IS NULL AND last_place IS NULL)
      OR (competitive = 1 AND entrant_kind IS NOT NULL AND last_place IS NOT NULL)),
  CHECK ((category = 'mini_contest' AND parent_id IS NOT NULL)
      OR (category != 'mini_contest' AND parent_id IS NULL))
);

CREATE TABLE place_points (
  event_id TEXT NOT NULL REFERENCES events(id),
  place INTEGER NOT NULL CHECK (place > 0),
  points INTEGER NOT NULL CHECK (points >= 0),
  PRIMARY KEY(event_id, place)
);

CREATE TABLE entrants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('individual','team')),
  UNIQUE(event_id, name)
);
CREATE INDEX entrants_event_idx ON entrants(event_id);

CREATE TABLE entrant_members (
  entrant_id TEXT NOT NULL REFERENCES entrants(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY(entrant_id, member_id),
  UNIQUE(event_id, member_id)
);

CREATE TABLE results (
  event_id TEXT NOT NULL REFERENCES events(id),
  place INTEGER NOT NULL CHECK (place > 0),
  entrant_id TEXT NOT NULL REFERENCES entrants(id),
  revision INTEGER NOT NULL,
  PRIMARY KEY(event_id, place),
  UNIQUE(event_id, entrant_id)
);

CREATE TABLE point_ledger (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  source_type TEXT NOT NULL DEFAULT 'event_result',
  source_id TEXT,
  event_id TEXT REFERENCES events(id),
  entrant_id TEXT REFERENCES entrants(id),
  place INTEGER,
  delta INTEGER NOT NULL,
  result_revision INTEGER,
  actor_id TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, member_id, result_revision, delta, place)
);
CREATE INDEX ledger_member_idx ON point_ledger(member_id);
CREATE UNIQUE INDEX ledger_non_event_unique ON point_ledger(source_type, source_id, member_id)
  WHERE source_type != 'event_result' AND delta > 0;

CREATE TABLE evidence_claims (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal_project','external_talk','external_competition','external_participation')),
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  points INTEGER,
  reviewed_by TEXT REFERENCES members(id),
  review_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(member_id, content_hash)
);
CREATE INDEX evidence_pending_idx ON evidence_claims(status, created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES members(id),
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT,
  UNIQUE(kind, entity_id)
);
CREATE INDEX jobs_ready_idx ON jobs(status, available_at);

CREATE TABLE leaderboard_cache (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  points INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE officer_roles (
  member_id TEXT NOT NULL REFERENCES members(id),
  role TEXT NOT NULL CHECK (role IN ('ambassador','secretariat','treasurer','external_relations','academics','executive','campus_lead')),
  PRIMARY KEY(member_id, role)
);

CREATE TABLE mail_routes (
  category TEXT PRIMARY KEY,
  required_roles_json TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES members(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE mail_drafts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL REFERENCES mail_routes(category),
  created_by TEXT NOT NULL REFERENCES members(id),
  current_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','released','sent','uncertain','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mail_revisions (
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id),
  revision INTEGER NOT NULL,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  pdf_text TEXT,
  content_hash TEXT NOT NULL,
  required_roles_json TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  edited_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision)
);

CREATE TABLE mail_approvals (
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  role TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision, role),
  FOREIGN KEY(draft_id, revision) REFERENCES mail_revisions(draft_id, revision)
);

CREATE TABLE mail_dispatch (
  draft_id TEXT PRIMARY KEY REFERENCES mail_drafts(id),
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent','uncertain','failed')),
  claimed_at TEXT,
  external_message_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(draft_id, revision) REFERENCES mail_revisions(draft_id, revision)
);
