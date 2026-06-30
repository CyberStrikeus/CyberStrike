CREATE TABLE IF NOT EXISTS coverage_note (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  class TEXT NOT NULL,
  scope TEXT NOT NULL,
  note TEXT NOT NULL,
  tested_by TEXT,
  request_id TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS coverage_note_cell_idx ON coverage_note(session_id, asset, class);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS coverage_note_session_idx ON coverage_note(session_id);
