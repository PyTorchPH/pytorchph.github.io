CREATE TABLE email_credentials (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE pending_email_signups (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  public_handle TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE auth_rate_limits (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (scope, subject_hash)
);
