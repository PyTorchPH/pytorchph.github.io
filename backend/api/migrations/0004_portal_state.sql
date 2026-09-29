-- Authenticated, user-scoped product demo state. The organization scope stores
-- shared synthetic workflows; it is never selected from a client-supplied ID.
CREATE TABLE portal_state (
    scope TEXT NOT NULL,
    state_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, state_key),
    CHECK (length(value_json) <= 262144)
);

CREATE TABLE portal_media (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    mime TEXT NOT NULL CHECK (mime = 'image/jpeg'),
    bytes BLOB NOT NULL CHECK (length(bytes) BETWEEN 100 AND 262144),
    created_at TEXT NOT NULL
);
CREATE INDEX portal_media_owner_created ON portal_media(owner_id, created_at);
