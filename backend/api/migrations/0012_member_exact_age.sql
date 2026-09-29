-- Members type their exact age instead of choosing a range. The row is absent when a member prefers
-- not to say (no NULLs). recorded_on lets reports compute today's age from the age given then.
-- Ranges shown to officers are derived at query time; exact ages are never listed.
CREATE TABLE member_ages (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  age INTEGER NOT NULL CHECK (age BETWEEN 13 AND 100),
  recorded_on TEXT NOT NULL CHECK (length(recorded_on) = 10)
);

-- A range cannot become an exact age, so earlier range answers are dropped; the onboarding form
-- asks those members for their age the next time they edit their profile.
ALTER TABLE member_profiles DROP COLUMN age_range;
