CREATE TABLE demo_fixtures (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
