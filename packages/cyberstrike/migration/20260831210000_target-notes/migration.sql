CREATE TABLE IF NOT EXISTS target_note (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  links TEXT NOT NULL,
  tags TEXT NOT NULL,
  author TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS target_note_session_idx ON target_note(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS target_note_entity_idx ON target_note(session_id, entity_id);
