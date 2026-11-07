-- signal fabric: durable stores for the deterministic web signal layer (Web Workflow 2.0, plan §07).
-- web_canary registers every injection's unique token (searched in later responses to catch stored /
-- second-order reflection). web_signal persists each cross-cutting lead a passive detector emits, deduped
-- per (session, dedup_key) and routed to an owning specialist. request_id is deliberately NOT a foreign
-- key: replay-elicited responses carry synthetic ids with no request row but must still persist a signal.
CREATE TABLE IF NOT EXISTS web_canary (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin_request_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  field TEXT NOT NULL,
  agent TEXT NOT NULL,
  vuln_class TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_canary_session_idx ON web_canary(session_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS web_canary_token_idx ON web_canary(session_id, token);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS web_signal (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  request_id TEXT NOT NULL,
  evidence TEXT NOT NULL,
  meta TEXT,
  status TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_signal_session_idx ON web_signal(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_signal_status_idx ON web_signal(session_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS web_signal_dedup_idx ON web_signal(session_id, dedup_key);
