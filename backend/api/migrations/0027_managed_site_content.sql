CREATE TABLE site_content_revisions (
 revision INTEGER PRIMARY KEY,
 body_json TEXT NOT NULL CHECK (json_valid(body_json)),
 edited_by TEXT REFERENCES members(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE site_content_state (
 id INTEGER PRIMARY KEY CHECK (id=1),
 draft_revision INTEGER NOT NULL REFERENCES site_content_revisions(revision),
 published_revision INTEGER NOT NULL REFERENCES site_content_revisions(revision)
);
CREATE TABLE site_content_approvals (
 revision INTEGER NOT NULL REFERENCES site_content_revisions(revision) ON DELETE CASCADE,
 approver_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 approved_at TEXT NOT NULL,
 PRIMARY KEY (revision, approver_id)
);
INSERT INTO site_content_revisions VALUES (1, '{"leadership":[],"events":[],"chapters":[],"articles":[]}', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO site_content_state VALUES (1, 1, 1);
