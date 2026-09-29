-- The school directory moves from a JSON file held in memory into SQLite with an FTS5 index:
-- search runs on disk with a small memory footprint, and every word the member types is its own
-- prefix keyword (any order, any column). Rows are loaded at startup from the compressed seed
-- (seeds/reference/schools.tsv.gz) whenever its version changes. Unknown text fields are ''.
CREATE TABLE schools (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  acronym TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('basic', 'higher', 'technical')),
  sector TEXT NOT NULL CHECK (sector IN ('public', 'private')),
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  region_code TEXT NOT NULL
);

-- External-content index over schools; the loader rebuilds it after each reload.
CREATE VIRTUAL TABLE school_search USING fts5(
  name, acronym, city, province,
  content = 'schools',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- Which version of each bundled reference catalog is loaded.
CREATE TABLE reference_catalog_versions (
  catalog TEXT PRIMARY KEY,
  version TEXT NOT NULL
);
