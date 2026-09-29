-- PyTorch Philippines is open to every age, so the exact age accepts 1 to 120 (a typo guard, not
-- an eligibility rule). SQLite cannot alter a CHECK, so member_ages is rebuilt; nothing references it.
-- Parental contact for young members is on the backlog (docs/BACKLOG.md).
CREATE TABLE member_ages_next (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  age INTEGER NOT NULL CHECK (age BETWEEN 1 AND 120),
  recorded_on TEXT NOT NULL CHECK (length(recorded_on) = 10)
);
INSERT INTO member_ages_next(member_id, age, recorded_on) SELECT member_id, age, recorded_on FROM member_ages;
DROP TABLE member_ages;
ALTER TABLE member_ages_next RENAME TO member_ages;
