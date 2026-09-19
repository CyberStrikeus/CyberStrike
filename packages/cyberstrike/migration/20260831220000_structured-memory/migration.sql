CREATE TABLE IF NOT EXISTS memory_entry (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  session_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  trust TEXT NOT NULL,
  confidence REAL NOT NULL,
  tags TEXT NOT NULL,
  related_ids TEXT NOT NULL,
  redacted INTEGER NOT NULL,
  valid_from INTEGER NOT NULL,
  invalid_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_entry_project_idx ON memory_entry(project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_entry_session_idx ON memory_entry(project_id, session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_entry_kind_idx ON memory_entry(project_id, kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_entry_valid_idx ON memory_entry(project_id, invalid_at);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS memory_entry_fts USING fts5(
  title,
  content,
  tags,
  content='memory_entry',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memory_entry_ai AFTER INSERT ON memory_entry BEGIN
  INSERT INTO memory_entry_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memory_entry_ad AFTER DELETE ON memory_entry BEGIN
  INSERT INTO memory_entry_fts(memory_entry_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memory_entry_au AFTER UPDATE ON memory_entry BEGIN
  INSERT INTO memory_entry_fts(memory_entry_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO memory_entry_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
