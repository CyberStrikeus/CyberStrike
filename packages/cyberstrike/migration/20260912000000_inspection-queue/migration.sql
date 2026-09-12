-- inspection_queue: domain-agnostic OO replacement for web_retest_queue.
-- Serves all domains (web, mobile, api, cloud, network); keyed by
-- (session_id, domain, target_key) instead of (session_id, key_hash).
-- Evidence replaces flags; examined_evidence replaces examined_flags.
CREATE TABLE IF NOT EXISTS inspection_queue (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  target_key TEXT NOT NULL,
  target_label TEXT,
  target_meta TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  evidence TEXT,
  examined_evidence TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inspection_queue_target_idx ON inspection_queue(session_id, domain, target_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inspection_queue_status_idx ON inspection_queue(session_id, domain, status);
