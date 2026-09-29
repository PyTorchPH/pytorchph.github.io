-- Bug report attachments and member-verified external accounts. Both belong to a member
-- and cascade with them.

-- Reports themselves live in the organization portal_state JSON; attachments are bounded
-- blobs stored once per report and kind, readable by officers and the reporter.
CREATE TABLE feedback_attachments (
  feedback_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('screenshot','page_state','logs')),
  reporter_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','text/html','application/json')),
  bytes BLOB NOT NULL CHECK (length(bytes) BETWEEN 1 AND 262144),
  created_at TEXT NOT NULL,
  PRIMARY KEY (feedback_id, kind)
);
CREATE INDEX feedback_attachments_reporter_idx ON feedback_attachments(reporter_id);

-- An account is verified when the extension reads the signed-in identity from the member's
-- own browser session on that site. One member per external account.
CREATE TABLE member_accounts (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github','linkedin','facebook')),
  handle TEXT NOT NULL CHECK (length(handle) BETWEEN 1 AND 100),
  profile_url TEXT NOT NULL CHECK (length(profile_url) BETWEEN 10 AND 300),
  verified_at TEXT NOT NULL,
  PRIMARY KEY (member_id, provider),
  UNIQUE (provider, handle)
);
