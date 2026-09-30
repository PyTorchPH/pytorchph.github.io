-- A normalized skill list compiled on a Technology officer's own computer with their own AI key
-- (the key never reaches the server). Each published version maps the raw skill words members
-- wrote on verified achievements ("BeautifulSoup", "playwright") to one normalized skill
-- ("Web scraping and automation"). The newest version drives the community skill tally.
CREATE TABLE skill_taxonomy_versions (
  id TEXT PRIMARY KEY,
  published_by TEXT NOT NULL,
  published_by_name TEXT NOT NULL,
  model_note TEXT NOT NULL,
  skill_count INTEGER NOT NULL CHECK (skill_count >= 1),
  published_at TEXT NOT NULL
);

CREATE TABLE skill_taxonomy_skills (
  version_id TEXT NOT NULL REFERENCES skill_taxonomy_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  PRIMARY KEY (version_id, name)
);

-- raw: a raw skill word, lowercased and trimmed; one raw word maps to one skill per version.
CREATE TABLE skill_taxonomy_aliases (
  version_id TEXT NOT NULL REFERENCES skill_taxonomy_versions(id) ON DELETE CASCADE,
  raw TEXT NOT NULL CHECK (length(raw) BETWEEN 1 AND 80),
  skill_name TEXT NOT NULL,
  PRIMARY KEY (version_id, raw),
  FOREIGN KEY (version_id, skill_name) REFERENCES skill_taxonomy_skills(version_id, name) ON DELETE CASCADE
);
