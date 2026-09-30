-- Collaborative event emails: the creator (with their own AI, or by hand) splits the email into
-- sections owned by positions and tags key phrases (date, venue, budget, …) for their owners.
-- Each owner sees only their parts. An owner's own edit counts as approved; anyone else's edit
-- sends that part back to its owner (a "cache miss"). When every part is confirmed and every
-- question answered, the email goes to the Secretary General, then the President, then the
-- Communications Officer (or the CMO) who sends it through the existing mail delivery.

-- Mail delivery gets its 'collaborative_event' route on first send (mail::assembled).

CREATE TABLE collab_drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
  recipients_json TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ai', 'manual')),
  stage TEXT NOT NULL CHECK (stage IN ('in_review', 'secretariat', 'president', 'sending', 'queued')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The mail draft a queued collaborative email became (present only once sent to delivery).
CREATE TABLE collab_deliveries (
  draft_id TEXT PRIMARY KEY REFERENCES collab_drafts(id) ON DELETE CASCADE,
  mail_draft_id TEXT NOT NULL,
  assembled_hash TEXT NOT NULL,
  queued_by TEXT NOT NULL,
  queued_at TEXT NOT NULL
);

CREATE TABLE collab_sections (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES collab_drafts(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL CHECK (ord >= 0),
  owner_position TEXT NOT NULL REFERENCES positions(slug),
  state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'changed')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  content_hash TEXT NOT NULL,
  UNIQUE (draft_id, ord)
);

CREATE TABLE collab_section_revisions (
  section_id TEXT NOT NULL REFERENCES collab_sections(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  author_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'human')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (section_id, revision)
);

-- A key phrase inside a section, owned by the position responsible for that fact.
CREATE TABLE collab_tags (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES collab_sections(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (label IN ('date', 'time', 'venue', 'budget', 'speaker', 'program', 'partner', 'link', 'contact', 'other')),
  phrase TEXT NOT NULL CHECK (length(phrase) BETWEEN 1 AND 300),
  owner_position TEXT NOT NULL REFERENCES positions(slug),
  state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'changed'))
);

-- Missing information the creator or AI asks a section's owner to supply.
CREATE TABLE collab_questions (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES collab_sections(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 300)
);
CREATE TABLE collab_answers (
  question_id TEXT PRIMARY KEY REFERENCES collab_questions(id) ON DELETE CASCADE,
  answer TEXT NOT NULL CHECK (length(trim(answer)) BETWEEN 1 AND 1000),
  answered_by TEXT NOT NULL,
  answered_at TEXT NOT NULL
);

-- Chain approvals bind to the exact assembled email (any later change invalidates them).
CREATE TABLE collab_approvals (
  draft_id TEXT NOT NULL REFERENCES collab_drafts(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('secretariat', 'president')),
  approver_id TEXT NOT NULL,
  assembled_hash TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, step)
);

-- Who did what to which part, with content hashes (not content) for the trail.
CREATE TABLE collab_audit (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  from_hash TEXT NOT NULL,
  to_hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX collab_audit_draft_idx ON collab_audit(draft_id, at);
CREATE INDEX collab_sections_owner_idx ON collab_sections(owner_position);
CREATE INDEX collab_tags_owner_idx ON collab_tags(owner_position);
