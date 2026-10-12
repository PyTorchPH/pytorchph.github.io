-- Event authority is independent from mailbox access and generic account roles.
CREATE TABLE event_position_grants (
  position_slug TEXT PRIMARY KEY REFERENCES positions(slug) ON DELETE CASCADE,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0,1)),
  can_create INTEGER NOT NULL DEFAULT 0 CHECK (can_create IN (0,1)),
  can_edit_owned_draft INTEGER NOT NULL DEFAULT 0 CHECK (can_edit_owned_draft IN (0,1)),
  can_edit_public_content INTEGER NOT NULL DEFAULT 0 CHECK (can_edit_public_content IN (0,1)),
  can_manage INTEGER NOT NULL DEFAULT 0 CHECK (can_manage IN (0,1)),
  can_publish INTEGER NOT NULL DEFAULT 0 CHECK (can_publish IN (0,1))
);
INSERT INTO event_position_grants VALUES
  ('president',1,1,1,1,1,1),
  ('head_learning_programs',1,1,1,1,1,1),
  ('learning_programs_officer',1,1,1,0,0,0),
  ('communications_officer',1,0,0,1,0,0),
  ('cmo',1,0,0,1,0,0);
