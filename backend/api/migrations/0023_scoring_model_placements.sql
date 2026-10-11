ALTER TABLE scoring_model_versions ADD COLUMN details_md TEXT NOT NULL DEFAULT '';
ALTER TABLE scoring_model_versions ADD COLUMN place_points_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(place_points_json));

CREATE TRIGGER scoring_model_immutable_update BEFORE UPDATE ON scoring_model_versions
BEGIN SELECT RAISE(ABORT, 'published scoring model is immutable'); END;
CREATE TRIGGER scoring_model_immutable_delete BEFORE DELETE ON scoring_model_versions
BEGIN SELECT RAISE(ABORT, 'published scoring model is immutable'); END;

ALTER TABLE event_scoring ADD COLUMN proposed_place_points_json TEXT CHECK (proposed_place_points_json IS NULL OR json_valid(proposed_place_points_json));
ALTER TABLE event_scoring ADD COLUMN selected_place_points_json TEXT CHECK (selected_place_points_json IS NULL OR json_valid(selected_place_points_json));
ALTER TABLE event_scoring ADD COLUMN placement_override_reason TEXT;
