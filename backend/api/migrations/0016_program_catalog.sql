-- Programs and strands become a catalog like schools, so answers share one spelling:
-- junior high special programs, senior high strands/clusters, college and graduate degrees
-- (PSA PSCED), and TESDA qualifications. Loaded at startup from seeds/reference/programs.tsv.gz.
-- Junior high now asks for its program too (Regular, STE, SPA, …); elementary still has none.
CREATE TABLE programs (
  code TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('junior_high','senior_high','undergraduate','graduate','technical_vocational')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  short_name TEXT NOT NULL,
  group_name TEXT NOT NULL
);
CREATE INDEX programs_level_idx ON programs(level, group_name, name);

CREATE VIRTUAL TABLE program_search USING fts5(
  name, short_name, group_name,
  content = 'programs',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- A member's program is a catalog code, or 'unlisted' with the typed name kept apart.
-- (No foreign key to programs: the catalog is reloaded wholesale.)
CREATE TABLE member_education_programs_next (
  member_id TEXT PRIMARY KEY REFERENCES member_education(member_id) ON DELETE CASCADE,
  program_code TEXT NOT NULL CHECK (length(program_code) BETWEEN 3 AND 40)
);
CREATE TABLE member_unlisted_programs (
  member_id TEXT PRIMARY KEY REFERENCES member_education_programs_next(member_id) ON DELETE CASCADE,
  program_name TEXT NOT NULL CHECK (length(trim(program_name)) BETWEEN 1 AND 120)
);

-- Earlier free-text answers become "unlisted" with their text preserved.
INSERT INTO member_education_programs_next(member_id, program_code)
SELECT member_id, 'unlisted' FROM member_education_programs;
INSERT INTO member_unlisted_programs(member_id, program_name)
SELECT member_id, program FROM member_education_programs;

DROP TABLE member_education_programs;
ALTER TABLE member_education_programs_next RENAME TO member_education_programs;
