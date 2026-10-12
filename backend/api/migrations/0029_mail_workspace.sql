-- Role-aware shared mailboxes. UUIDs remain internal identities; users select messages by metadata.
CREATE TABLE mail_aliases (
  alias TEXT PRIMARY KEY CHECK (alias LIKE '%@pytorch.ph'),
  label TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
INSERT INTO mail_aliases(alias,label) VALUES
  ('events@pytorch.ph','Events'),
  ('membership@pytorch.ph','Membership'),
  ('inquiry@pytorch.ph','Inquiries'),
  ('partnerships@pytorch.ph','Partnerships');

CREATE TABLE mail_alias_grants (
  alias TEXT NOT NULL REFERENCES mail_aliases(alias) ON DELETE CASCADE,
  position_slug TEXT NOT NULL REFERENCES positions(slug) ON DELETE CASCADE,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0,1)),
  can_draft INTEGER NOT NULL DEFAULT 0 CHECK (can_draft IN (0,1)),
  can_approve INTEGER NOT NULL DEFAULT 0 CHECK (can_approve IN (0,1)),
  can_send_as INTEGER NOT NULL DEFAULT 0 CHECK (can_send_as IN (0,1)),
  can_manage INTEGER NOT NULL DEFAULT 0 CHECK (can_manage IN (0,1)),
  PRIMARY KEY(alias,position_slug)
);
INSERT INTO mail_alias_grants VALUES
  ('events@pytorch.ph','head_learning_programs',1,1,1,0,1),
  ('events@pytorch.ph','learning_programs_officer',1,1,0,0,0),
  ('events@pytorch.ph','communications_officer',1,1,0,1,0),
  ('events@pytorch.ph','cmo',1,1,1,1,1),
  ('membership@pytorch.ph','secretary_general',1,1,1,1,1),
  ('inquiry@pytorch.ph','community_outreach_officer',1,1,0,1,0),
  ('inquiry@pytorch.ph','head_partnerships_outreach',1,1,1,1,1),
  ('partnerships@pytorch.ph','head_partnerships_outreach',1,1,1,1,1),
  ('partnerships@pytorch.ph','community_outreach_officer',1,1,0,0,0);

ALTER TABLE collab_drafts ADD COLUMN mailbox_alias TEXT NOT NULL DEFAULT 'events@pytorch.ph';
ALTER TABLE collab_drafts ADD COLUMN message_type TEXT NOT NULL DEFAULT 'other'
  CHECK (message_type IN ('workshop','hackathon','competition','talk','learning_lesson','other'));
ALTER TABLE collab_drafts ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE SET NULL;

CREATE TABLE mail_workspace_messages (
  id TEXT PRIMARY KEY,
  mailbox_alias TEXT NOT NULL REFERENCES mail_aliases(alias) ON DELETE RESTRICT,
  folder TEXT NOT NULL CHECK (folder IN ('inbox','sent')),
  message_type TEXT NOT NULL CHECK (message_type IN ('workshop','hackathon','competition','talk','learning_lesson','other')),
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  thread_key TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
  correspondent_label TEXT NOT NULL CHECK (length(trim(correspondent_label)) BETWEEN 1 AND 200),
  preview TEXT NOT NULL CHECK (length(preview) <= 500),
  received_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  source_uid TEXT,
  rfc_message_id TEXT,
  UNIQUE(mailbox_alias,source_uid),
  UNIQUE(rfc_message_id)
);
CREATE INDEX mail_workspace_folder ON mail_workspace_messages(mailbox_alias,folder,message_type,received_at DESC);
