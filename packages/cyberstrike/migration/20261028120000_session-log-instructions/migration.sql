CREATE TABLE IF NOT EXISTS session_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  time_created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS session_log_seq_idx ON session_log(session_id, seq);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS session_instruction (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  PRIMARY KEY (session_id, key)
);
