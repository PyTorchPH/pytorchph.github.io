-- Publication is independent of competitive result publication.
CREATE TABLE event_publication (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  topic TEXT NOT NULL DEFAULT '' CHECK (length(topic) <= 500),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  venue TEXT NOT NULL DEFAULT '' CHECK (length(venue) <= 300),
  registration_url TEXT NOT NULL DEFAULT '' CHECK (length(registration_url) <= 2000),
  series TEXT NOT NULL DEFAULT '' CHECK (length(series) <= 200),
  CHECK (is_demo = 0 OR registration_url = ''),
  CHECK (is_public = 0 OR length(trim(description)) > 0)
);
CREATE INDEX event_publication_visible_idx ON event_publication(is_public, event_id);
