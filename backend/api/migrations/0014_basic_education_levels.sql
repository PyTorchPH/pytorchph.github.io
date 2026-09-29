-- The school directory now covers basic education, so members can study at any level:
--   elementary    Grade 1-6      no program
--   junior_high   Grade 7-10     no program
--   senior_high   Grade 11-12    strand (was year 1-2; converted to Grade 11-12)
--   undergraduate / graduate / technical_vocational   Year 1-8   program or course
-- A program exists only for levels that have one, so it moves to its own table (no NULLs, no '').
-- SQLite cannot alter CHECK constraints, so the tables are rebuilt; rows are copied through
-- backups because dropping member_education cascades to member_unlisted_schools.
CREATE TABLE member_education_backup AS SELECT * FROM member_education;
CREATE TABLE member_unlisted_schools_backup AS SELECT * FROM member_unlisted_schools;
DROP TABLE member_unlisted_schools;
DROP TABLE member_education;

CREATE TABLE member_education (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  -- A code from the school directory (schools.code), or 'unlisted'.
  school_code TEXT NOT NULL CHECK (length(school_code) BETWEEN 3 AND 40),
  level TEXT NOT NULL CHECK (level IN ('elementary','junior_high','senior_high','undergraduate','graduate','technical_vocational')),
  -- Grade for basic education, year for everything after it.
  year_level INTEGER NOT NULL CHECK (
    (level = 'elementary' AND year_level BETWEEN 1 AND 6)
    OR (level = 'junior_high' AND year_level BETWEEN 7 AND 10)
    OR (level = 'senior_high' AND year_level BETWEEN 11 AND 12)
    OR (level IN ('undergraduate','graduate','technical_vocational') AND year_level BETWEEN 1 AND 8)
  )
);
CREATE INDEX member_education_school_idx ON member_education(school_code);

-- Strand (senior high) or program/course (college, graduate, tech-voc).
CREATE TABLE member_education_programs (
  member_id TEXT PRIMARY KEY REFERENCES member_education(member_id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK (length(trim(program)) BETWEEN 1 AND 120)
);

CREATE TABLE member_unlisted_schools (
  member_id TEXT PRIMARY KEY REFERENCES member_education(member_id) ON DELETE CASCADE,
  school_name TEXT NOT NULL CHECK (length(trim(school_name)) BETWEEN 2 AND 160)
);

INSERT INTO member_education(member_id, school_code, level, year_level)
SELECT member_id, school_code, level,
       CASE WHEN level = 'senior_high' THEN min(max(year_level, 1), 2) + 10 ELSE year_level END
FROM member_education_backup;
INSERT INTO member_education_programs(member_id, program)
SELECT member_id, program FROM member_education_backup;
INSERT INTO member_unlisted_schools(member_id, school_name)
SELECT member_id, school_name FROM member_unlisted_schools_backup;

DROP TABLE member_education_backup;
DROP TABLE member_unlisted_schools_backup;
