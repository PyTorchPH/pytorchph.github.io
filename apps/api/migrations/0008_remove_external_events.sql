-- Members and officers can no longer submit external events; the feature and its stored
-- organization-scope state are removed.
DELETE FROM portal_state WHERE state_key = '/api/events' OR state_key LIKE '/api/events/%';
