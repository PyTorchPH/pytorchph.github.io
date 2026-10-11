ALTER TABLE skill_comparisons ADD COLUMN season_slug TEXT;

DROP INDEX scheduled_pair_revision;
CREATE UNIQUE INDEX manual_pair_revision
  ON skill_comparisons(skill_slug, member_a, member_b, evidence_revision)
  WHERE season_slug IS NULL AND evidence_revision IS NOT NULL;
CREATE UNIQUE INDEX scheduled_pair_season
  ON skill_comparisons(skill_slug, member_a, member_b, season_slug)
  WHERE season_slug IS NOT NULL;

CREATE INDEX scheduled_season_progress
  ON skill_comparisons(season_slug, skill_slug, created_at)
  WHERE season_slug IS NOT NULL;
