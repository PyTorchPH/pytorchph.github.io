-- Disk overflow for the admission queue: requests that do not fit in the RAM queue are stored
-- here, replayed highest priority first, and their responses kept until expires_at. The owner
-- is a member id (never a session token) and spooled work cascades with the member.
CREATE TABLE request_spool (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 9),
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 2048),
  content_type TEXT,
  origin TEXT,
  body BLOB,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  response_status INTEGER,
  response_type TEXT,
  response_body BLOB,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX request_spool_next ON request_spool(status, priority, created_at);
CREATE INDEX request_spool_member ON request_spool(member_id);
CREATE INDEX request_spool_expiry ON request_spool(expires_at);
