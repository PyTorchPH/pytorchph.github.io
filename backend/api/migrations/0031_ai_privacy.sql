CREATE TABLE ai_privacy_consents (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('learning_recommendations','officer_assistant')),
  granted INTEGER NOT NULL CHECK(granted IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id,purpose)
);
CREATE TABLE ai_projection_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  subject_alias TEXT NOT NULL,
  key_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ai_projection_expiry ON ai_projection_requests(expires_at);
