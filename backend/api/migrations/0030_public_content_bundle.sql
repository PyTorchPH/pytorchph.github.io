-- Dynamic public bundle: canonical curriculum events plus a bounded cache for official PyTorch news.
CREATE TABLE featured_learning_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  date_status TEXT NOT NULL,
  schedule_label TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  registration_url TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL,
  modules TEXT NOT NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

-- Runtime content is provisioned privately.


CREATE TABLE official_news_cache (
  source TEXT PRIMARY KEY CHECK (source='pytorch_blog'),
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
